import { describe, expect, it } from "vitest";
import { embedUrl, parseDriveId, parseLessonSource, parseYouTubeId, slugify } from "@/lib/lesson-source";

describe("parseYouTubeId", () => {
  const id = "abcdefghijk";

  it("accepts the links staff paste from the address bar", () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
    expect(parseYouTubeId(`https://youtu.be/${id}`)).toBe(id);
    expect(parseYouTubeId(`https://www.youtube.com/embed/${id}`)).toBe(id);
    expect(parseYouTubeId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
    expect(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${id}`)).toBe(id);
    expect(parseYouTubeId(id)).toBe(id);
  });

  it("rejects other hosts and ids that are not 11 characters", () => {
    expect(parseYouTubeId(`https://evil.example/watch?v=${id}`)).toBeNull();
    expect(parseYouTubeId("https://youtu.be/short")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
  });
});

describe("parseDriveId", () => {
  it("reads a file id from Drive share links", () => {
    expect(parseDriveId("https://drive.google.com/file/d/FILE_id-123/view")).toBe("FILE_id-123");
    expect(parseDriveId("https://drive.google.com/open?id=FILE_id-123")).toBe("FILE_id-123");
    expect(parseDriveId("https://drive.google.com/uc?id=FILE_id-123")).toBe("FILE_id-123");
  });

  it("does not treat a YouTube link as a document", () => {
    expect(parseDriveId("https://youtu.be/abcdefghijk")).toBeNull();
  });
});

describe("parseLessonSource", () => {
  it("prefers a Drive file over a YouTube id when both could match", () => {
    expect(parseLessonSource("https://drive.google.com/file/d/FILE_id-123/view")).toEqual({
      type: "pdf",
      id: "FILE_id-123",
    });
    expect(parseLessonSource("https://youtu.be/abcdefghijk")).toEqual({
      type: "youtube",
      id: "abcdefghijk",
    });
    expect(parseLessonSource("hello")).toBeNull();
  });
});

describe("embedUrl", () => {
  it("uses the nocookie YouTube host and a Drive preview for documents", () => {
    expect(embedUrl({ type: "youtube", id: "abcdefghijk" })).toContain(
      "https://www.youtube-nocookie.com/embed/abcdefghijk"
    );
    expect(embedUrl({ type: "pdf", id: "FILE_id-123" })).toBe(
      "https://drive.google.com/file/d/FILE_id-123/preview"
    );
  });
});

describe("slugify", () => {
  it("builds a lowercase hyphenated path and drops apostrophes", () => {
    expect(slugify("Women's Hair Replacement")).toBe("womens-hair-replacement");
    expect(slugify("Certificado en Prótesis Capilares")).toBe("certificado-en-protesis-capilares");
    expect(slugify("  ---  ")).toBe("");
    expect(slugify("a".repeat(200)).length).toBe(80);
  });
});
