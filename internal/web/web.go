// Package web serves the React UI (embedded in the binary) and a small JSON
// API over the same store the terminal UI uses.
package web

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Prathmeshgumal/nib/internal/store"
)

//go:embed all:dist
var assets embed.FS

type Server struct {
	store *store.Store
	auth  *Auth
	URL   string
	srv   *http.Server
	ln    net.Listener
}

// New binds a listener immediately so the caller knows the real URL (and any
// port conflict) before anything is served. It listens on the loopback
// interface only and asks nobody for a password: it is for the person sitting
// at this machine.
func New(s *store.Store, port int) (*Server, error) {
	return listen(s, fmt.Sprintf("127.0.0.1:%d", port), nil)
}

// NewHosted is the same server put on the network behind a password, for the
// hosted copy that every device syncs with. addr is a full host:port; a hosted
// platform hands the port over in the environment and expects every interface.
func NewHosted(s *store.Store, addr string, auth *Auth) (*Server, error) {
	if auth == nil {
		return nil, errors.New("a hosted server needs a password")
	}
	return listen(s, addr, auth)
}

func listen(s *store.Store, addr string, auth *Auth) (*Server, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("%s is not available: %w", addr, err)
	}
	url := "http://localhost:" + fmt.Sprint(ln.Addr().(*net.TCPAddr).Port)
	srv := &Server{store: s, auth: auth, ln: ln, URL: url}
	srv.srv = &http.Server{
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		// A hosted server meets the open internet. These bound how long one
		// slow connection can hold a goroutine; uploads of 50 MB on a slow
		// line are the reason the write limit is not tighter.
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}
	return srv, nil
}

func (s *Server) Start() { go s.srv.Serve(s.ln) }

func (s *Server) Stop() error { return s.srv.Close() }

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	// Health is open even on a hosted server, because the platform's checker
	// has no password. It says nothing about the notes.
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/sync", s.handleSync)
	mux.HandleFunc("/api/sync/attachments", s.handleSyncAttachments)
	mux.HandleFunc("/api/sync/attachments/", s.handleSyncAttachment)
	mux.HandleFunc("/api/notes", s.handleCollection)
	mux.HandleFunc("/api/notes/", s.handleItem)
	mux.HandleFunc("/api/trash", s.handleTrash)
	mux.HandleFunc("/api/trash/", s.handleTrashItem)
	mux.HandleFunc("/api/attachments", s.handleUpload)
	mux.HandleFunc("/attachments/", s.handleAttachment)
	mux.Handle("/", s.staticHandler())
	if s.auth == nil {
		return mux
	}
	return s.auth.Wrap(mux, "/api/health")
}

// handleTrash lists what is recoverable, or empties the trash outright.
func (s *Server) handleTrash(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		notes, err := s.store.Trash()
		if err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, notes)
	case http.MethodDelete:
		n, err := s.store.EmptyTrash()
		if err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"deleted": n})
	default:
		w.Header().Set("Allow", "GET, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleTrashItem restores a single trashed note, or destroys it.
func (s *Server) handleTrashItem(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/trash/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodPost:
		if err := s.store.Restore(id); err != nil {
			notFoundOr(w, err)
			return
		}
		note, err := s.store.Get(id)
		if err != nil {
			notFoundOr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, note)
	case http.MethodDelete:
		if err := s.store.Purge(id); err != nil {
			notFoundOr(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "POST, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// staticHandler serves the embedded bundle, falling back to index.html so
// client-side routes work on a hard refresh.
func (s *Server) staticHandler() http.Handler {
	sub, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}
	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(sub, path); err != nil {
			index, err := fs.ReadFile(sub, "index.html")
			if err != nil {
				http.Error(w, "UI not built", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(index)
			return
		}
		if strings.HasPrefix(path, "assets/") {
			// Asset filenames are content-hashed, so they can be cached hard.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}

type noteBody struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func (s *Server) handleCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		notes, err := s.store.List(r.URL.Query().Get("q"))
		if err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, notes)
	case http.MethodPost:
		var b noteBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		note, err := s.store.Create(b.Title, b.Content)
		if err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, note)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleItem(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/notes/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		note, err := s.store.Get(id)
		if err != nil {
			notFoundOr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, note)
	case http.MethodPut:
		var b noteBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		note, err := s.store.Update(id, b.Title, b.Content)
		if err != nil {
			notFoundOr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, note)
	case http.MethodDelete:
		if err := s.store.Delete(id); err != nil {
			notFoundOr(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "GET, PUT, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func notFoundOr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "note not found"})
		return
	}
	serverError(w, err)
}

func serverError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}
