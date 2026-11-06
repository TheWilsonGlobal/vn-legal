import { describe, expect, it } from "vitest";
import {
  MAX_FIELD_CHARS,
  REDACTED,
  maskPayload,
  redactText,
} from "../../../src/observability/mask";

describe("maskPayload capture modes (AC 30)", () => {
  it("metadata_only replaces every string and object with [redacted]", () => {
    expect(maskPayload("Dieu 123 Bo luat Dan su", "metadata_only")).toBe(
      REDACTED,
    );
    expect(maskPayload('{"query":"0912345678"}', "metadata_only")).toBe(
      REDACTED,
    );
    expect(maskPayload({ q: "x" }, "metadata_only")).toBe(REDACTED);
    expect(maskPayload(["a"], "metadata_only")).toBe(REDACTED);
  });

  it("metadata_only keeps numbers, booleans and null (ok flags, citation counts)", () => {
    expect(maskPayload(true, "metadata_only")).toBe(true);
    expect(maskPayload(3, "metadata_only")).toBe(3);
    expect(maskPayload(null, "metadata_only")).toBeNull();
  });

  it("full passes the value through unchanged", () => {
    const value = { q: "0912345678 a@b.co" };
    expect(maskPayload(value, "full")).toBe(value);
  });

  it("masked redacts string leaves inside objects and keeps keys", () => {
    const out = maskPayload(
      { query: "so 0912345678", count: 2 },
      "masked",
    ) as Record<string, unknown>;
    expect(out).toEqual({ query: "so [phone]", count: 2 });
  });
});

describe("redactText (masked mode regexes, AC 30)", () => {
  it("redacts emails", () => {
    expect(redactText("gui toi nguyen.van+a@example.com nhe")).toBe(
      "gui toi [email] nhe",
    );
  });

  it("redacts Vietnamese mobile numbers in local and international form", () => {
    expect(redactText("so 0912345678")).toBe("so [phone]");
    expect(redactText("+84 912 345 678")).toBe("[phone]");
    expect(redactText("+84912345678")).toBe("[phone]");
  });

  it("redacts 9-digit and 12-digit ID numbers", () => {
    expect(redactText("CCCD 012345678901")).toBe("CCCD [id]");
    expect(redactText("CMND 123456789")).toBe("CMND [id]");
  });

  it("redacts bank-account-like digit runs", () => {
    expect(redactText("stk 1234567890123456789")).toBe("stk [account]");
    expect(redactText("tai khoan 0011 0012 3456")).toBe("tai khoan [account]");
  });

  it("leaves short numbers such as article numbers alone", () => {
    expect(redactText("Dieu 123, khoan 4")).toBe("Dieu 123, khoan 4");
  });

  // R9-01 / R9-02: over-redaction seen in Vietnamese legal text. Each string below
  // was rewritten by the old regexes; these expectations fail without the fix.
  it("leaves dd-mm-yyyy dates alone", () => {
    expect(redactText("hiệu lực từ 01-01-2025")).toBe("hiệu lực từ 01-01-2025");
    expect(redactText("ngày 2025-01-01 và 1-2-2024")).toBe(
      "ngày 2025-01-01 và 1-2-2024",
    );
  });

  it("leaves a list of years alone", () => {
    expect(redactText("các năm 2020 2021 2022 2023")).toBe(
      "các năm 2020 2021 2022 2023",
    );
  });

  it("leaves a plain amount that names a currency alone", () => {
    expect(redactText("giá 1000000000 đồng")).toBe("giá 1000000000 đồng");
    expect(redactText("phạt từ 1.000.000.000 đồng")).toBe(
      "phạt từ 1.000.000.000 đồng",
    );
    expect(redactText("mức 5000000000 VND")).toBe("mức 5000000000 VND");
  });

  it("leaves Vietnamese legal citations and dotted amounts alone", () => {
    expect(redactText("Điều 125 và Luật số 91/2015/QH13")).toBe(
      "Điều 125 và Luật số 91/2015/QH13",
    );
    expect(redactText("lệ phí 50.000.000 đồng")).toBe("lệ phí 50.000.000 đồng");
  });

  it("redacts a +84 number written with a (0) trunk digit", () => {
    expect(redactText("+84 (0) 912 345 678")).toBe("[phone]");
  });

  it("does not leave a stray digit after a mobile number with an extra group", () => {
    expect(redactText("0912 345 678 9")).toBe("[account]");
    expect(redactText("gọi 0912 345 678 nhé")).toBe("gọi [phone] nhé");
  });

  it("redacts an email written inside Vietnamese text without leaving a name fragment", () => {
    expect(redactText("liên hệ nguyễna@example.vn để biết thêm")).toBe(
      "liên hệ [email] để biết thêm",
    );
    expect(redactText("gửi tới a.b@x.vn, cảm ơn.")).toBe(
      "gửi tới [email], cảm ơn.",
    );
  });

  it("truncates each field to MAX_FIELD_CHARS characters", () => {
    const long = "a".repeat(MAX_FIELD_CHARS + 500);
    const out = redactText(long);
    expect(out.length).toBe(MAX_FIELD_CHARS);
    expect(out).toBe("a".repeat(MAX_FIELD_CHARS));
  });

  it("normalises to NFC before matching and keeps Vietnamese text intact", () => {
    const decomposed = "Điều 123".normalize("NFD");
    expect(redactText(decomposed)).toBe("Điều 123".normalize("NFC"));
  });
});
