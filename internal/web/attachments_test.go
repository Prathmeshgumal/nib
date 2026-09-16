package web

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const fakePNG = "\x89PNG\r\n\x1a\npretend this is a picture"

func TestServesAnAttachment(t *testing.T) {
	h, st := newTestServer(t)
	ref, err := st.Attachments().Add("shot.png", strings.NewReader(fakePNG))
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/attachments/"+ref.Base(), nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", got)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("Cache-Control = %q, want it cached hard: the name is a content hash", got)
	}
	if rec.Body.String() != fakePNG {
		t.Errorf("body did not round-trip")
	}
}

func TestRefusesABadAttachmentName(t *testing.T) {
	h, _ := newTestServer(t)
	for _, path := range []string{
		"/attachments/8F3A91C2D4E5F607.png",
		"/attachments/nonsense",
		"/attachments/8f3a91c2d4e5f607.png",
		"/attachments/",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
}

func TestAttachmentRejectsOtherMethods(t *testing.T) {
	h, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/attachments/8f3a91c2d4e5f607.png", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE = %d, want 405", rec.Code)
	}
}

func TestUploadStoresAndDescribes(t *testing.T) {
	h, _ := newTestServer(t)

	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	part, err := mw.CreateFormFile("file", "holiday photo.png")
	if err != nil {
		t.Fatal(err)
	}
	part.Write([]byte(fakePNG))
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/attachments", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", rec.Code, rec.Body)
	}
	var got struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Markdown string `json:"markdown"`
		MIME     string `json:"mime"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.MIME != "image/png" {
		t.Errorf("mime = %q, want image/png", got.MIME)
	}
	if want := "![holiday photo.png](attachments/" + got.ID + ".png)"; got.Markdown != want {
		t.Errorf("markdown = %q, want %q", got.Markdown, want)
	}

	// And it is immediately servable at the path that markdown names.
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/attachments/"+got.ID+".png", nil))
	if rec2.Code != http.StatusOK {
		t.Errorf("serving what we just uploaded: %d", rec2.Code)
	}
}

func TestUploadNeedsAFile(t *testing.T) {
	h, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/attachments", strings.NewReader("not multipart"))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", rec.Code)
	}
}

func TestUploadRejectsOtherMethods(t *testing.T) {
	h, _ := newTestServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/attachments", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET = %d, want 405", rec.Code)
	}
}
