package web

import (
	"errors"
	"net/http"
	"strings"

	"github.com/Prathmeshgumal/nib/internal/attach"
)

// handleAttachment serves one stored file.
//
// It lives at /attachments/ rather than under /api/ because that is the path
// the markdown inside a note already spells: the page is served from /, so a
// relative "attachments/x.png" resolves here on its own, with nothing rewriting
// anything. http.ServeMux prefers the longer pattern, so this wins over the
// single-page fallback without any ordering care.
func (s *Server) handleAttachment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	base := strings.TrimPrefix(r.URL.Path, "/attachments/")
	f, err := s.store.Attachments().Read(base)
	if err != nil {
		// A refused name and a missing file get the same answer: nobody
		// should be able to tell a malformed request from a real absence.
		if errors.Is(err, attach.ErrBadName) || errors.Is(err, attach.ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		serverError(w, err)
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		serverError(w, err)
		return
	}

	// The name is the hash of the contents, so these bytes can never come to
	// mean anything else. ServeContent adds the content type, the ETag and
	// range handling from the name and the file itself.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, base, info.ModTime(), f)
}

// handleUpload stores one file and answers with the markdown line for it.
//
// The line is built on this side rather than in the browser so that
// attach.Ref stays the only writer of the reference format. A second speller
// of it is how the sweeper and the notes end up disagreeing about which files
// are still in use.
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Leave room for the multipart envelope, and let attach.Add be the one
	// that decides the file itself is too big.
	r.Body = http.MaxBytesReader(w, r.Body, attach.MaxSize+1<<20)

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "expected a file"})
		return
	}
	defer file.Close()

	ref, err := s.store.Attachments().Add(header.Filename, file)
	if errors.Is(err, attach.ErrTooLarge) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
			"error": "that file is larger than 50 MB",
		})
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":       ref.ID,
		"name":     ref.Name,
		"mime":     ref.MIME,
		"size":     ref.Size,
		"markdown": ref.Markdown(),
	})
}
