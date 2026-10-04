package web

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Prathmeshgumal/nib/internal/attach"
	"github.com/Prathmeshgumal/nib/internal/store"
)

// SyncRequest is what a device sends: where it last got to, and what it has
// changed since it last sent anything.
type SyncRequest struct {
	Since  string           `json:"since"`
	Notes  []store.SyncNote `json:"notes"`
	Purged []store.Purged   `json:"purged"`
}

// SyncResponse is what the server sends back: everything that changed here
// since the device's cursor, and the cursor to use next time.
type SyncResponse struct {
	Cursor string           `json:"cursor"`
	Notes  []store.SyncNote `json:"notes"`
	Purged []store.Purged   `json:"purged"`
}

// maxSyncBody bounds one sync request. The first sync of a large library is
// the biggest there will be; notes are text, so this is far beyond a real one.
const maxSyncBody = 64 << 20

// handleSync takes a device's changes and answers with the server's.
//
// The cursor is read before the device's changes are applied. Anything written
// during this request is stamped at or after it, so the device sees it on its
// next pull; reading the cursor afterwards could skip a write that landed in
// between.
func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSyncBody)
	var req SyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	cursor := store.Cursor()
	if _, err := s.store.Apply(req.Notes, req.Purged); err != nil {
		serverError(w, err)
		return
	}
	notes, purged, err := s.store.ChangesSince(store.CursorBefore(req.Since))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, SyncResponse{Cursor: cursor, Notes: notes, Purged: purged})
}

// handleSyncAttachments lists the files this side holds, so a device can work
// out which ones to send and which to fetch.
func (s *Server) handleSyncAttachments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	names, err := s.store.Blobs().List()
	if err != nil {
		serverError(w, err)
		return
	}
	if names == nil {
		names = []string{}
	}
	writeJSON(w, http.StatusOK, names)
}

// handleSyncAttachment receives one file under the exact name it already has.
func (s *Server) handleSyncAttachment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", "PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	base := strings.TrimPrefix(r.URL.Path, "/api/sync/attachments/")
	r.Body = http.MaxBytesReader(w, r.Body, attach.MaxSize+1)
	err := s.store.Blobs().Put(base, r.Body)
	switch {
	case errors.Is(err, attach.ErrBadName):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name does not match contents"})
	case errors.Is(err, attach.ErrTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file too large"})
	case err != nil:
		serverError(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
