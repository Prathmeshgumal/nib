// Command nib is a local-first Markdown note taker: a terminal UI by
// default, with an optional web interface served from the same binary.
//
// Notes live in a SQLite file on this machine. Optionally they are kept in
// step with a hosted copy in Postgres (see `nib serve` and `nib login`), so the
// same notes are reachable from anywhere.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"golang.org/x/term"

	"github.com/Prathmeshgumal/nib/internal/store"
	"github.com/Prathmeshgumal/nib/internal/syncer"
	"github.com/Prathmeshgumal/nib/internal/tui"
	"github.com/Prathmeshgumal/nib/internal/web"
)

var version = "dev"

// syncEvery is how often a running nib checks the server for changes.
const syncEvery = time.Minute

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "serve":
			serve(os.Args[2:])
			return
		case "login":
			login(os.Args[2:])
			return
		case "logout":
			logout(os.Args[2:])
			return
		case "sync":
			syncOnce(os.Args[2:])
			return
		}
	}

	var (
		webOnly = flag.Bool("web", false, "run only the web UI (no terminal interface)")
		port    = flag.Int("port", 4321, "port for the web UI")
		dbPath  = flag.String("db", tui.DefaultPath(), "path to the notes database")
		offline = flag.Bool("offline", false, "do not sync with the server this run")
		showVer = flag.Bool("version", false, "print the version and exit")
	)
	flag.Usage = usage
	flag.Parse()

	if *showVer {
		fmt.Println("nib", version)
		return
	}

	// Notes written under the program's previous name follow it here.
	if *dbPath == tui.DefaultPath() {
		moved, err := store.AdoptLegacy(*dbPath, tui.LegacyPath())
		if err != nil {
			fmt.Fprintln(os.Stderr, "warning: could not bring your old notes across:", err)
		} else if moved {
			fmt.Fprintf(os.Stderr, "Your notes moved to %s — the old copy is still at %s\n",
				*dbPath, tui.LegacyPath())
		}
	}

	// Copy the database before touching it, so a bad day is always recoverable.
	if _, err := store.Snapshot(*dbPath); err != nil {
		fmt.Fprintln(os.Stderr, "warning: could not write a snapshot:", err)
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	defer st.Close()

	var client *syncer.Client
	if !*offline {
		client = configuredClient(*dbPath)
	}

	// The first time this machine meets a server it pulls before anything
	// else. Seeding the welcome note first would leave two of them once the
	// library arrives, one from each side.
	if client != nil {
		if prev, _ := st.Meta("sync_remote"); prev == "" {
			fmt.Fprintln(os.Stderr, "Fetching your notes from the server…")
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			if res, err := client.Sync(ctx, st); err != nil {
				fmt.Fprintln(os.Stderr, "warning: could not sync:", err)
			} else {
				fmt.Fprintln(os.Stderr, "Synced:", res)
			}
			cancel()
		}
	}

	// A brand-new database opens on a welcome note rather than an empty screen.
	if err := st.SeedIfEmpty(); err != nil {
		fmt.Fprintln(os.Stderr, "warning: could not add the welcome note:", err)
	}

	if *webOnly {
		runWeb(st, *port, client)
		return
	}

	prog := tea.NewProgram(tui.New(st), tea.WithAltScreen(), tea.WithMouseCellMotion())
	stop := startBackgroundSync(client, st, func(text string) { prog.Send(tui.SyncedMsg{Text: text}) })

	_, err = prog.Run()
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `nib — Markdown notes in your terminal and your browser

Usage:
  nib [flags]               open the terminal UI
  nib --web                 serve only the web UI on this machine
  nib login <server-url>    sign in to a hosted nib and start syncing
  nib logout                stop syncing and forget the login
  nib sync                  sync once and exit
  nib serve                 run the hosted server (see the README)

Flags:
`)
	flag.PrintDefaults()
}

// configuredClient returns a client for the saved server, or nil if there is
// none or it cannot be used. Never being logged in is not worth a message.
func configuredClient(dbPath string) *syncer.Client {
	remote, err := syncer.LoadRemote(dbPath)
	if err != nil {
		if !errors.Is(err, syncer.ErrNoRemote) {
			fmt.Fprintln(os.Stderr, "warning: sync is off:", err)
		}
		return nil
	}
	c, err := syncer.New(remote)
	if err != nil {
		fmt.Fprintln(os.Stderr, "warning: sync is off:", err)
		return nil
	}
	return c
}

// startBackgroundSync syncs now, then every minute, and once more when the
// returned function is called. A sync that fails is not an error: the person
// is working locally, and the next attempt tries again. notify is told when
// something came down from the server.
func startBackgroundSync(c *syncer.Client, st *store.Store, notify func(string)) (stop func()) {
	if c == nil {
		return func() {}
	}
	done := make(chan struct{})
	finished := make(chan struct{})
	run := func(timeout time.Duration) (syncer.Result, error) {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		return c.Sync(ctx, st)
	}
	go func() {
		defer close(finished)
		t := time.NewTicker(syncEvery)
		defer t.Stop()
		for first := true; ; first = false {
			if !first {
				select {
				case <-done:
					return
				case <-t.C:
				}
			}
			res, err := run(3 * time.Minute)
			switch {
			case err != nil:
				notify("sync failed: " + firstLine(err.Error()))
			case res.Received > 0 || res.Downloaded > 0:
				notify(fmt.Sprintf("synced: %d notes from the server", res.Received))
			}
		}
	}()
	return func() {
		close(done)
		<-finished
		// One last go so what was just typed is on the server before exit,
		// but not so long that quitting feels stuck.
		if res, err := run(20 * time.Second); err != nil {
			fmt.Fprintln(os.Stderr, "warning: final sync failed:", firstLine(err.Error()))
		} else if res.Sent > 0 {
			fmt.Fprintln(os.Stderr, "Synced:", res)
		}
	}
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func runWeb(st *store.Store, port int, client *syncer.Client) {
	srv, err := web.New(st, port)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	srv.Start()
	fmt.Printf("\n  nib web UI at %s\n  Database: %s\n", srv.URL, st.Path)
	if client != nil {
		fmt.Printf("  Syncing with the server every %s\n", syncEvery)
	}
	fmt.Printf("  Ctrl+C to stop\n\n")

	stop := startBackgroundSync(client, st, func(text string) { fmt.Println("  " + text) })
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	_ = srv.Stop()
	stop()
}

// syncOnce is `nib sync`.
func syncOnce(args []string) {
	fs := flag.NewFlagSet("sync", flag.ExitOnError)
	dbPath := fs.String("db", tui.DefaultPath(), "path to the notes database")
	fs.Parse(args)

	client := configuredClient(*dbPath)
	if client == nil {
		fmt.Fprintln(os.Stderr, "error:", syncer.ErrNoRemote)
		os.Exit(1)
	}
	st, err := store.Open(*dbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	defer st.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	res, err := client.Sync(ctx, st)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Println("Synced:", res)
}

// login is `nib login <url>`: it asks for the name and password, proves they
// work by syncing once, and only then saves them.
func login(args []string) {
	fs := flag.NewFlagSet("login", flag.ExitOnError)
	dbPath := fs.String("db", tui.DefaultPath(), "path to the notes database")
	user := fs.String("user", "", "user name (asked for if omitted)")
	fs.Parse(args)
	if fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: nib login [--user NAME] <server-url>")
		os.Exit(2)
	}

	name := *user
	if name == "" {
		name = prompt("User name: ")
	}
	pass := os.Getenv("NIB_PASSWORD")
	if pass == "" {
		pass = promptSecret("Password: ")
	}
	remote := syncer.Remote{URL: fs.Arg(0), User: name, Password: pass}
	client, err := syncer.New(remote)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	defer st.Close()

	fmt.Println("Connecting (a sleeping free server can take a minute to wake)…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	res, err := client.Sync(ctx, st)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if err := syncer.SaveRemote(*dbPath, remote); err != nil {
		fmt.Fprintln(os.Stderr, "error: signed in, but could not save the login:", err)
		os.Exit(1)
	}
	fmt.Println("Signed in and synced:", res)
	fmt.Println("From now on nib syncs whenever it runs. Use `nib logout` to stop.")
}

func logout(args []string) {
	fs := flag.NewFlagSet("logout", flag.ExitOnError)
	dbPath := fs.String("db", tui.DefaultPath(), "path to the notes database")
	fs.Parse(args)
	if err := syncer.ForgetRemote(*dbPath); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Println("Signed out. Your notes stay on this machine and on the server.")
}

func prompt(label string) string {
	fmt.Fprint(os.Stderr, label)
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimSpace(line)
}

func promptSecret(label string) string {
	fmt.Fprint(os.Stderr, label)
	if term.IsTerminal(int(os.Stdin.Fd())) {
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err == nil {
			return string(b)
		}
	}
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimSpace(line)
}

// serve is `nib serve`: the hosted copy. It keeps the notes in Postgres, takes
// its login from the environment, and listens on the port the platform names.
func serve(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dsn := fs.String("database-url", os.Getenv("DATABASE_URL"), "Postgres connection string (or set DATABASE_URL)")
	addr := fs.String("addr", defaultAddr(), "address to listen on (or set PORT)")
	fs.Parse(args)

	user, pass := os.Getenv("NIB_USER"), os.Getenv("NIB_PASSWORD")
	switch {
	case *dsn == "":
		fatal("no database: set DATABASE_URL to your Supabase connection string")
	case user == "" || pass == "":
		fatal("no login: set NIB_USER and NIB_PASSWORD. The server is on the public internet and will not start without one")
	case len(pass) < 12:
		fatal("NIB_PASSWORD is too short: use at least 12 characters, it is all that stands between the internet and your notes")
	}

	st, err := store.OpenPostgres(*dsn)
	if err != nil {
		fatal(err.Error())
	}
	defer st.Close()

	srv, err := web.NewHosted(st, *addr, web.NewAuth(user, pass))
	if err != nil {
		fatal(err.Error())
	}
	srv.Start()
	fmt.Printf("nib server listening on %s\n", *addr)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	_ = srv.Stop()
}

// defaultAddr listens on every interface on $PORT, which is how Render and
// most hosts say where they will send traffic.
func defaultAddr() string {
	if p := os.Getenv("PORT"); p != "" {
		return ":" + p
	}
	return ":8080"
}

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, "error:", msg)
	os.Exit(1)
}
