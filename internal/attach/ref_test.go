package attach

import (
	"slices"
	"testing"
)

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

func TestRefsFindsEveryForm(t *testing.T) {
	md := `# Notes

![shot](attachments/8f3a91c2d4e5f607.png) and a file
[report.pdf](attachments/2b7c0419aa3d1e88.pdf).

The same image again: ![again](attachments/8f3a91c2d4e5f607.png)
`
	got := Refs(md)
	want := []string{"8f3a91c2d4e5f607", "2b7c0419aa3d1e88"}
	if !slices.Equal(got, want) {
		t.Errorf("Refs = %v, want %v (in order, without repeats)", got, want)
	}
}

func TestRefsIgnoresWhatIsNotOurs(t *testing.T) {
	md := `
![remote](https://example.com/attachments/8f3a91c2d4e5f607.png)
![short](attachments/8f3a91.png)
![capitals](attachments/8F3A91C2D4E5F607.png)
[a folder](attachments/)
plain text mentioning attachments/ and nothing else
`
	if got := Refs(md); len(got) != 0 {
		t.Errorf("Refs = %v, want none of these to count", got)
	}
}

func TestRefsOfAnEmptyNote(t *testing.T) {
	if got := Refs(""); len(got) != 0 {
		t.Errorf("Refs = %v, want empty", got)
	}
}

func TestMarkdownAndRefsAgree(t *testing.T) {
	// Whatever Markdown writes, Refs must find. These two are the only writer
	// and the only reader of the format; if they drift apart, Sweep trashes
	// files that notes are still using.
	for _, r := range []Ref{
		{ID: "8f3a91c2d4e5f607", Name: "shot.png", Ext: ".png", MIME: "image/png"},
		{ID: "2b7c0419aa3d1e88", Name: "report.pdf", Ext: ".pdf", MIME: "application/pdf"},
		{ID: "0123456789abcdef", Name: "photo [final].png", Ext: ".png", MIME: "image/png"},
		{ID: "fedcba9876543210", Name: "", Ext: ".bin", MIME: "application/octet-stream"},
	} {
		got := Refs(r.Markdown())
		if len(got) != 1 || got[0] != r.ID {
			t.Errorf("Refs(%q) = %v, want [%s]", r.Markdown(), got, r.ID)
		}
	}
}

func TestDescribeKeepsTheNameForContainerFormats(t *testing.T) {
	// A .docx is a zip, and so is every other Office file, every .odt and
	// every .epub. Sniffing the bytes says "zip" and stops there, which is how
	// a Word document ends up opening in an archive manager.
	zip := []byte("PK\x03\x04\x14\x00\x06\x00 and then some bytes")

	for _, c := range []struct {
		name string
		want string
	}{
		{"report.docx", ".docx"},
		{"budget.xlsx", ".xlsx"},
		{"deck.pptx", ".pptx"},
		{"book.epub", ".epub"},
		{"notes.odt", ".odt"},
		{"archive.zip", ".zip"}, // genuinely a zip, and says so
		{"mystery", ".zip"},     // nothing to go on: fall back to the type
	} {
		mime, ext := describe(zip, c.name)
		if mime != "application/zip" {
			t.Errorf("%s: mime = %q, want application/zip", c.name, mime)
		}
		if ext != c.want {
			t.Errorf("%s: ext = %q, want %q", c.name, ext, c.want)
		}
	}
}

func TestDescribeKeepsTheNameForTextFormats(t *testing.T) {
	// text/plain is the same kind of catch-all: markdown, CSV, JSON and source
	// code are all "plain text" to a sniffer, and all open in different things.
	text := []byte("a,b,c\n1,2,3\n")

	for _, c := range []struct{ name, want string }{
		{"data.csv", ".csv"},
		{"notes.md", ".md"},
		{"config.json", ".json"},
		{"README", ".txt"}, // no extension to keep
		{"plain.txt", ".txt"},
	} {
		if _, ext := describe(text, c.name); ext != c.want {
			t.Errorf("%s: ext = %q, want %q", c.name, ext, c.want)
		}
	}
}

func TestDescribeStillTrustsTheBytesForRealFormats(t *testing.T) {
	// A PNG named .jpg is still a PNG: for a format whose bytes identify it,
	// the contents win and the name is ignored.
	png := []byte("\x89PNG\r\n\x1a\nnot really")
	if mime, ext := describe(png, "photo.jpg"); mime != "image/png" || ext != ".png" {
		t.Errorf("describe = %q, %q; want image/png, .png", mime, ext)
	}
}
