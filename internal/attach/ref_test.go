package attach

import "testing"

func TestDescribeNamesFilesAfterTheirContents(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + "the rest does not matter")
	gif := []byte("GIF89a and some more")
	pdf := []byte("%PDF-1.7\nnot really a pdf")

	for _, c := range []struct {
		what     string
		head     []byte
		name     string
		wantMIME string
		wantExt  string
	}{
		{"a png", png, "shot.png", "image/png", ".png"},
		{"a png misnamed as a jpg", png, "shot.jpg", "image/png", ".png"},
		{"a gif", gif, "loop.gif", "image/gif", ".gif"},
		{"a pdf", pdf, "report.pdf", "application/pdf", ".pdf"},
		{"plain text", []byte("just words"), "notes.txt", "text/plain", ".txt"},
	} {
		mime, ext := describe(c.head, c.name)
		if mime != c.wantMIME || ext != c.wantExt {
			t.Errorf("%s: describe = %q, %q; want %q, %q", c.what, mime, ext, c.wantMIME, c.wantExt)
		}
	}
}

func TestDescribeFallsBackToTheGivenName(t *testing.T) {
	// Bytes the sniffer cannot place, with a plausible extension on the name.
	odd := []byte{0x00, 0x01, 0x02, 0x03, 0xff, 0xfe}

	if _, ext := describe(odd, "archive.tar.zst"); ext != ".zst" {
		t.Errorf("ext = %q, want .zst taken from the name", ext)
	}
	if _, ext := describe(odd, "LICENSE"); ext != ".bin" {
		t.Errorf("ext = %q, want .bin when the name offers nothing", ext)
	}
	if _, ext := describe(odd, "weird.LOUD"); ext != ".loud" {
		t.Errorf("ext = %q, want the extension lowercased", ext)
	}
	// A name that would escape the directory contributes nothing.
	if _, ext := describe(odd, "../../etc/passwd"); ext != ".bin" {
		t.Errorf("ext = %q, want .bin for a name with no usable extension", ext)
	}
}

func TestDescribeIsDeterministic(t *testing.T) {
	jpg := []byte("\xff\xd8\xff\xe0 jpeg-ish")
	first, firstExt := describe(jpg, "a.jpg")
	for i := 0; i < 100; i++ {
		mime, ext := describe(jpg, "a.jpg")
		if mime != first || ext != firstExt {
			t.Fatalf("describe is not deterministic: got %q,%q then %q,%q", first, firstExt, mime, ext)
		}
	}
	if firstExt != ".jpg" {
		t.Errorf("ext = %q, want .jpg", firstExt)
	}
}

func TestRefMarkdown(t *testing.T) {
	image := Ref{ID: "8f3a91c2d4e5f607", Name: "screenshot.png", Ext: ".png", MIME: "image/png"}
	if got, want := image.Markdown(), "![screenshot.png](attachments/8f3a91c2d4e5f607.png)"; got != want {
		t.Errorf("image: got %q, want %q", got, want)
	}

	doc := Ref{ID: "2b7c0419aa3d1e88", Name: "report.pdf", Ext: ".pdf", MIME: "application/pdf"}
	if got, want := doc.Markdown(), "[report.pdf](attachments/2b7c0419aa3d1e88.pdf)"; got != want {
		t.Errorf("document: got %q, want %q", got, want)
	}
}

func TestRefMarkdownEscapesTheName(t *testing.T) {
	// A filename with brackets would otherwise end the link text early and
	// leave the rest of the name loose in the note.
	r := Ref{ID: "0123456789abcdef", Name: "photo [final] (2).png", Ext: ".png", MIME: "image/png"}
	got := r.Markdown()
	want := `![photo \[final\] (2).png](attachments/0123456789abcdef.png)`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRefMarkdownSurvivesAnEmptyName(t *testing.T) {
	r := Ref{ID: "0123456789abcdef", Name: "", Ext: ".png", MIME: "image/png"}
	if got, want := r.Markdown(), "![image](attachments/0123456789abcdef.png)"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
