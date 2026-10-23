import { describe, expect, it } from "vitest";
import { convertToString } from "./buffer";

describe("convertToString", () => {
  it("decodes a Buffer with the given charset, a BOM or UTF-8", () => {
    const specialChars = "äöüßéèêëàáâãåçñ¿¡";
    const cases: Array<
      [
        label: string,
        input: string | Buffer,
        charset: string | undefined,
        expected: string,
      ]
    > = [
      ["string unchanged", "Hello, world!", undefined, "Hello, world!"],
      [
        "UTF-8 by default",
        Buffer.from("Hello, world!", "utf-8"),
        undefined,
        "Hello, world!",
      ],
      ["UTF-8", Buffer.from("Hello, world!", "utf-8"), "utf-8", "Hello, world!"],
      ["ISO-8859-1", Buffer.from("Café", "latin1"), "iso-8859-1", "Café"],
      [
        "ISO-8859-1 specials",
        Buffer.from(specialChars, "latin1"),
        "iso-8859-1",
        specialChars,
      ],
      ["UTF-8 specials", Buffer.from(specialChars, "utf-8"), "utf-8", specialChars],
      ["empty Buffer", Buffer.from([]), undefined, ""],
      // The byte order mark is stripped.
      [
        "UTF-16LE BOM",
        Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]),
        "utf-16le",
        "hi",
      ],
      [
        "UTF-16BE BOM",
        Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]),
        "utf-16be",
        "hi",
      ],
      ["UTF-8 BOM", Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]), "utf-8", "hi"],
      // An unknown charset falls back to UTF-8.
      [
        "invalid charset",
        Buffer.from("Simple ASCII content", "utf-8"),
        "invalid-charset-name",
        "Simple ASCII content",
      ],
    ];

    for (const [label, input, charset, expected] of cases) {
      expect.soft(convertToString(input, charset), label).toBe(expected);
    }
  });
});
