package web

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"net/url"
	"time"
)

// Auth guards a hosted server with one account.
//
// This is a personal notes app, so there is one user and no database of users:
// the name and password come from the environment of the host. HTTP Basic is
// used because it is the one scheme both a browser and the sync client speak
// with no extra code - the browser asks once and then sends it with every
// request, the client sets a header. The password never crosses the network in
// the clear because the hosting platform terminates TLS.
type Auth struct {
	user, pass [sha256.Size]byte
}

// NewAuth builds the guard. Both are compared as hashes of fixed length, so
// the comparison takes the same time whatever is guessed and however long the
// real values are.
func NewAuth(user, password string) *Auth {
	return &Auth{user: sha256.Sum256([]byte(user)), pass: sha256.Sum256([]byte(password))}
}

func (a *Auth) check(user, pass string) bool {
	u, p := sha256.Sum256([]byte(user)), sha256.Sum256([]byte(pass))
	// Both comparisons always run, so a wrong name is not faster than a wrong
	// password.
	okU := subtle.ConstantTimeCompare(u[:], a.user[:])
	okP := subtle.ConstantTimeCompare(p[:], a.pass[:])
	return okU&okP == 1
}

// failDelay slows a wrong guess down. It is a cheap brake on someone trying
// passwords against the public URL, and costs the one real user nothing.
const failDelay = time.Second

// Wrap puts the password in front of next. Paths in open are let through.
func (a *Auth) Wrap(next http.Handler, open ...string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, p := range open {
			if r.URL.Path == p {
				next.ServeHTTP(w, r)
				return
			}
		}
		user, pass, ok := r.BasicAuth()
		if !ok || !a.check(user, pass) {
			if ok {
				time.Sleep(failDelay)
			}
			w.Header().Set("WWW-Authenticate", `Basic realm="nib", charset="UTF-8"`)
			http.Error(w, "sign in to nib", http.StatusUnauthorized)
			return
		}
		if !sameSite(r) {
			http.Error(w, "cross-site request refused", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// sameSite refuses a request that changes something on behalf of another
// website. Once a browser has been given the password it sends it to this host
// with every request, including ones a page on a different site makes; for a
// request that only reads that is harmless, but a forged DELETE would not be.
func sameSite(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" {
		return site == "same-origin" || site == "none"
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // not a browser: the sync client and curl send neither header
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host
}
