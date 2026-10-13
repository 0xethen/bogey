import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { createTranslator, formatMessage, type ParamArgs } from "../src/messages.ts";
import { negotiateLocale, parseAcceptLanguage } from "../src/locale.ts";

describe("formatMessage", () => {
  test("fills slots and formats numbers for the locale", () => {
    expect(formatMessage("Hello {name}, you have {n} new", { name: "Ada", n: 1234 }, "en")).toBe(
      "Hello Ada, you have 1,234 new",
    );
    expect(formatMessage("{n}", { n: 1234 }, "de")).toBe("1.234");
  });

  test("a missing value stays visible", () => {
    expect(formatMessage("Hi {name}")).toBe("Hi {name}");
  });

  test("plurals pick by the language's rules and # shows the number", () => {
    const message = "{count, plural, =0 {No projects} one {# project} other {# projects}}";
    expect(formatMessage(message, { count: 0 })).toBe("No projects");
    expect(formatMessage(message, { count: 1 })).toBe("1 project");
    expect(formatMessage(message, { count: 2500 })).toBe("2,500 projects");
    const polish = "{n, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}";
    expect(formatMessage(polish, { n: 3 }, "pl")).toBe("3 pliki");
    expect(formatMessage(polish, { n: 5 }, "pl")).toBe("5 plików");
  });

  test("slots can sit inside text around a plural, and braces can be escaped", () => {
    expect(
      formatMessage("{who} has {count, plural, one {# vote} other {# votes}}.", {
        who: "Sam",
        count: 2,
      }),
    ).toBe("Sam has 2 votes.");
    expect(formatMessage("Use \\{braces\\} here")).toBe("Use {braces} here");
    expect(formatMessage("100% sure, it's fine")).toBe("100% sure, it's fine");
  });

  test("parameter names are read from the text by the types", () => {
    expectTypeOf<ParamArgs<"Hi">>().toEqualTypeOf<[]>();
    expectTypeOf<ParamArgs<"Hi {name}">>().toEqualTypeOf<[params: { name: string | number }]>();
    expectTypeOf<ParamArgs<"{a} and {count, plural, one {# x} other {# xs}}">>().toEqualTypeOf<
      [params: { a: string | number; count: string | number }]
    >();
  });
});

describe("locales", () => {
  test("Accept-Language is ordered by preference", () => {
    expect(parseAcceptLanguage("fr;q=0.5, es-MX, en;q=0.8, *;q=0.1")).toEqual([
      "es-MX",
      "en",
      "fr",
    ]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("xx_bad, en;q=0")).toEqual([]);
  });

  test("the first wish a catalog can meet wins, then the source language", () => {
    const supported = ["en", "es", "pt-BR"];
    expect(negotiateLocale(["es-MX", "en"], supported)).toBe("es");
    expect(negotiateLocale([null, "PT-br"], supported)).toBe("pt-BR");
    expect(negotiateLocale(["pt"], supported)).toBe("pt-BR");
    expect(negotiateLocale(["ja", "de"], supported)).toBe("en");
    expect(negotiateLocale([], supported)).toBe("en");
  });
});

describe("createTranslator", () => {
  const source = {
    "a.hello": "Hello {name}",
    "a.items": "{n, plural, one {# item} other {# items}}",
  } as const;
  const es = { "a.hello": "Hola {name}" };
  const translate = (options: Partial<Parameters<typeof createTranslator>[1]> = {}) =>
    createTranslator(source, { locale: "es", overlay: es, ...options });

  test("uses the translation, and English where there is none", () => {
    const t = translate();
    expect(t("a.hello", { name: "Ada" })).toBe("Hola Ada");
    expect(t("a.items", { n: 2 })).toBe("2 items");
  });

  test("can show the key instead of English", () => {
    expect(translate({ missing: "key" })("a.items", { n: 2 })).toBe("a.items");
    expect(translate({ missing: "key" })("a.hello", { name: "Ada" })).toBe("Hola Ada");
  });

  test("can show another language before English", () => {
    const t = translate({
      missing: "language",
      fallback: { "a.items": "{n, plural, one {# cosa} other {# cosas}}" },
    });
    expect(t("a.items", { n: 2 })).toBe("2 cosas");
    expect(translate({ missing: "language" })("a.items", { n: 1 })).toBe("1 item");
  });

  test("a key that exists nowhere shows as itself and never throws", () => {
    const t = createTranslator(source, { locale: "en", overlay: {} }) as unknown as (
      key: string,
    ) => string;
    expect(t("nav.notifs")).toBe("nav.notifs");
    expect(
      createTranslator(source, { locale: "en", overlay: { "a.hello": 42 as unknown as string } })(
        "a.hello",
        { name: "x" },
      ),
    ).toBe("Hello x");
  });
});
