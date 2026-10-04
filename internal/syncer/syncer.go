// Package syncer keeps a local database and the hosted server in step.
//
// The local SQLite file stays the thing the terminal and the browser read and
// write, so nib is as fast and as available offline as it ever was. Syncing is
// a separate step that runs at start-up, on exit, and now and then in between:
// it sends what changed here, takes what changed there, and copies the
// attachments each side is missing. If the server is asleep or unreachable it
// fails and the next attempt picks up where this one stopped.
package syncer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Prathmeshgumal/nib/internal/attach"
	"github.com/Prathmeshgumal/nib/internal/store"
	"github.com/Prathmeshgumal/nib/internal/web"
)

// Remote is where the hosted server is and who to be when talking to it.
type Remote struct {
	URL      string `json:"url"`
	User     string `json:"user"`
	Password string `json:"password"`
}

// Result says what a sync did, for the line shown to the person.
type Result struct {
	Sent, Received       int
	Uploaded, Downloaded int
}

func (r Result) String() string {
	return fmt.Sprintf("sent %d, received %d notes; %d files up, %d down",
		r.Sent, r.Received, r.Uploaded, r.Downloaded)
}

// ErrNoRemote means no server has been set up.
var ErrNoRemote = errors.New("no server configured: run `nib login <url>` first")

const (
	metaCursor = "sync_cursor"
	metaRemote = "sync_remote"
)

// Client talks to one server.
type Client struct {
	remote Remote
	http   *http.Client
}

// New checks the address and returns a client for it.
func New(r Remote) (*Client, error) {
	r.URL = strings.TrimRight(strings.TrimSpace(r.URL), "/")
	u, err := url.Parse(r.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("%q is not a server address like https://my-nib.onrender.com", r.URL)
	}
	// A password sent over plain http is readable by anyone on the path. It is
	// allowed to a machine on this one, which is how the server is tried out.
	if u.Scheme == "http" && !isLoopback(u.Hostname()) {
		return nil, fmt.Errorf("refusing to send a password over http to %s: use https", u.Host)
	}
	return &Client{remote: r, http: &http.Client{Timeout: 3 * time.Minute}}, nil
}

func isLoopback(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (c *Client) do(ctx context.Context, method, path string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.remote.URL+path, body)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.remote.User, c.remote.Password)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.http.Do(req)
}

// wake pokes a server that may be asleep. A free host stops an idle service
// and starts it again on the next request, which can take the better part of a
// minute, so the first request is allowed to be slow and is retried.
func (c *Client) wake(ctx context.Context) error {
	var last error
	for attempt := 0; attempt < 6; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
			}
		}
		res, err := c.do(ctx, http.MethodGet, "/api/health", nil, "")
		if err != nil {
			last = err
			continue
		}
		res.Body.Close()
		if res.StatusCode == http.StatusOK {
			return nil
		}
		last = fmt.Errorf("server answered %s", res.Status)
	}
	return fmt.Errorf("server is not answering: %w", last)
}

// Sync runs one round.
func (c *Client) Sync(ctx context.Context, st *store.Store) (Result, error) {
	var res Result
	if err := c.wake(ctx); err != nil {
		return res, err
	}

	// A different server than last time means none of what we remember about
	// it applies: start again and offer everything.
	if prev, _ := st.Meta(metaRemote); prev != c.remote.URL {
		if err := st.MarkAllDirty(); err != nil {
			return res, err
		}
		if err := st.SetMeta(metaCursor, ""); err != nil {
			return res, err
		}
		if err := st.SetMeta(metaRemote, c.remote.URL); err != nil {
			return res, err
		}
	}

	notes, purged, err := st.Dirty()
	if err != nil {
		return res, err
	}
	since, err := st.Meta(metaCursor)
	if err != nil {
		return res, err
	}

	body, err := json.Marshal(web.SyncRequest{Since: since, Notes: notes, Purged: purged})
	if err != nil {
		return res, err
	}
	resp, err := c.do(ctx, http.MethodPost, "/api/sync", bytes.NewReader(body), "application/json")
	if err != nil {
		return res, err
	}
	defer resp.Body.Close()
	if err := checkStatus(resp); err != nil {
		return res, err
	}
	var reply web.SyncResponse
	if err := json.NewDecoder(resp.Body).Decode(&reply); err != nil {
		return res, fmt.Errorf("reading the server's answer: %w", err)
	}

	// Take the server's changes first, then record what was sent. If this
	// stops between the two, the next sync repeats both, and repeating is safe.
	if res.Received, err = st.Apply(reply.Notes, reply.Purged); err != nil {
		return res, err
	}
	if err := st.MarkClean(notes, purged); err != nil {
		return res, err
	}
	res.Sent = len(notes) + len(purged)

	// The cursor only moves once the attachments are done: if they fail the
	// notes are already safe, and the next round retries the files.
	res.Uploaded, res.Downloaded, err = c.syncAttachments(ctx, st)
	if err != nil {
		return res, err
	}
	return res, st.SetMeta(metaCursor, reply.Cursor)
}

func checkStatus(res *http.Response) error {
	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
		return nil
	case res.StatusCode == http.StatusUnauthorized:
		return errors.New("the server rejected the name or password: run `nib login` again")
	default:
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("server answered %s: %s", res.Status, strings.TrimSpace(string(msg)))
	}
}

// syncAttachments copies across the files one side has and the other lacks,
// for the attachments the notes actually refer to. Files are named for the
// hash of their contents, so "has" is a question about the name alone.
func (c *Client) syncAttachments(ctx context.Context, st *store.Store) (up, down int, err error) {
	wanted, err := st.ReferencedAttachments()
	if err != nil {
		return 0, 0, err
	}
	if len(wanted) == 0 {
		return 0, 0, nil
	}

	local, err := st.Blobs().List()
	if err != nil {
		return 0, 0, err
	}
	resp, err := c.do(ctx, http.MethodGet, "/api/sync/attachments", nil, "")
	if err != nil {
		return 0, 0, err
	}
	var remote []string
	err = func() error {
		defer resp.Body.Close()
		if err := checkStatus(resp); err != nil {
			return err
		}
		return json.NewDecoder(resp.Body).Decode(&remote)
	}()
	if err != nil {
		return 0, 0, err
	}

	byID := func(names []string) map[string]string {
		m := make(map[string]string, len(names))
		for _, n := range names {
			m[attach.IDOf(n)] = n
		}
		return m
	}
	haveLocal, haveRemote := byID(local), byID(remote)

	for id := range wanted {
		lname, hasLocal := haveLocal[id]
		rname, hasRemote := haveRemote[id]
		switch {
		case hasLocal && !hasRemote:
			if err := c.upload(ctx, st, lname); err != nil {
				return up, down, err
			}
			up++
		case hasRemote && !hasLocal:
			if err := c.download(ctx, st, rname); err != nil {
				return up, down, err
			}
			down++
		}
	}
	return up, down, nil
}

func (c *Client) upload(ctx context.Context, st *store.Store, base string) error {
	f, _, err := st.Blobs().Open(base)
	if err != nil {
		return err
	}
	defer f.Close()
	resp, err := c.do(ctx, http.MethodPut, "/api/sync/attachments/"+base, f, "application/octet-stream")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkStatus(resp)
}

func (c *Client) download(ctx context.Context, st *store.Store, base string) error {
	resp, err := c.do(ctx, http.MethodGet, "/attachments/"+base, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := checkStatus(resp); err != nil {
		return err
	}
	return st.Blobs().Put(base, resp.Body)
}

// ConfigPath is where the server's address and login are kept: beside the
// database, so pointing --db somewhere else takes its sync settings along.
func ConfigPath(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "remote.json")
}

// LoadRemote finds the configured server. The environment wins over the file,
// so a one-off run can point somewhere else without touching it.
func LoadRemote(dbPath string) (Remote, error) {
	r := Remote{
		URL:      os.Getenv("NIB_REMOTE"),
		User:     os.Getenv("NIB_USER"),
		Password: os.Getenv("NIB_PASSWORD"),
	}
	if r.URL != "" && r.User != "" && r.Password != "" {
		return r, nil
	}
	data, err := os.ReadFile(ConfigPath(dbPath))
	if errors.Is(err, os.ErrNotExist) {
		return Remote{}, ErrNoRemote
	}
	if err != nil {
		return Remote{}, err
	}
	var saved Remote
	if err := json.Unmarshal(data, &saved); err != nil {
		return Remote{}, fmt.Errorf("reading %s: %w", ConfigPath(dbPath), err)
	}
	if r.URL == "" {
		r.URL = saved.URL
	}
	if r.User == "" {
		r.User = saved.User
	}
	if r.Password == "" {
		r.Password = saved.Password
	}
	if r.URL == "" {
		return Remote{}, ErrNoRemote
	}
	return r, nil
}

// SaveRemote writes the login where only this user can read it.
func SaveRemote(dbPath string, r Remote) error {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	path := ConfigPath(dbPath)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600) // WriteFile keeps the mode of a file that existed
}

// ForgetRemote removes the saved login.
func ForgetRemote(dbPath string) error {
	err := os.Remove(ConfigPath(dbPath))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
