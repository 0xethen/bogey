import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_EMAIL_LAYOUT, layoutProblem } from "../src/email-layout.ts";
import {
  footerWords,
  localizedTemplateKey,
  markdownToEmailHtml,
  markdownToEmailText,
  pickTemplate,
  renderEmail,
  renderTemplate,
  templateVariables,
  translatedEmail,
} from "../src/email-template.ts";

const LAYOUT = "<html><body><b>{{brand}}</b>{{content}}<i>{{org}}</i></body></html>";

function render(body: string, values: Record<string, string> = {}, layout = LAYOUT) {
  return renderEmail({
    layout,
    fallbackLayout: DEFAULT_EMAIL_LAYOUT,
    subject: "Hi {{org}}",
    body,
    org: "Acme",
    platform: "Bogey",
    reason: "someone asked to sign in to {{org}} with {{email}}",
    values,
  });
}

test("fills known placeholders and blanks unknown ones", () => {
  expect(
    renderTemplate("Code {{ code }} for {{org}}{{secret}}", { code: "123456", org: "Acme" }),
  ).toBe("Code 123456 for Acme");
});

test("lists the placeholders a template uses", () => {
  expect(templateVariables("{{code}} and {{ link }}, {{code}} again")).toEqual(["code", "link"]);
});

test("headings, lists, quotes and rules", () => {
  const html = markdownToEmailHtml(
    "# Title\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---",
  );
  expect(html).toContain("<h1");
  expect(html).toContain("<ul");
  expect(html.match(/<li>/g)).toHaveLength(4);
  expect(html).toContain("<ol");
  expect(html).toContain("<blockquote");
  expect(html).toContain("<hr");
});

test("links, bold, italic and inline code", () => {
  const html = markdownToEmailHtml(
    "**Hi** *there* _you_, [sign in](https://x.test/a?token_hash=b_c) or `code`",
  );
  expect(html).toContain("<strong>Hi</strong>");
  expect(html).toContain("<em>there</em>");
  expect(html).toContain("<em>you</em>");
  expect(html).toMatch(/<a [^>]*href="https:\/\/x\.test\/a\?token_hash=b_c"[^>]*>sign in<\/a>/);
  expect(html).toContain("<code");
});

test("a bold link alone is a button, and code alone is the code box", () => {
  const html = markdownToEmailHtml("**[Sign in]({{link}})**\n\n`{{code}}`");
  expect(html).toContain('class="button"');
  expect(html).toContain('href="{{link}}"');
  expect(html).toContain('class="codebox"');
});

test("raw HTML in the source is shown as text, not run", () => {
  const html = markdownToEmailHtml('<script>alert(1)</script> <img src=x onerror=y> "quoted"');
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;");
});

test("only http(s) links and placeholders become links", () => {
  const html = markdownToEmailHtml("[bad](javascript:alert(1)) [ok](https://x.test)");
  expect(html).not.toContain('href="javascript');
  expect(html).toContain('href="https://x.test"');
});

test("a link can't break out of its attribute", () => {
  const html = markdownToEmailHtml('**[go](https://x.test/"onmouseover="x)**');
  expect(html).not.toContain('"onmouseover="');
});

test("values are escaped wherever they land", () => {
  const { html, text } = render("Hello {{org}}\n\n**[Go]({{link}})**", {
    org: "<script>x</script>",
    link: 'https://x.test/?a=1&b="2"',
  });
  expect(html).not.toContain("<script>x");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("https://x.test/?a=1&amp;b=&quot;2&quot;");
  expect(text).toContain('Go: https://x.test/?a=1&b="2"');
});

test("a value can't add markup by looking like markdown or a placeholder", () => {
  const { html } = render("Hi {{org}}", { org: "*{{code}}*", code: "SECRET" });
  expect(html).not.toContain("<em>");
  expect(html).not.toContain("SECRET");
});

test("the layout gets the brand, the content and the org", () => {
  const { html } = render("Body");
  expect(html).toContain("<b><table");
  expect(html).toContain(">Acme</td>");
  expect(html).toContain("Body");
  expect(html).toContain("<i>Acme</i>");
});

test("a logo replaces the name in the brand", () => {
  const { html } = render("Body", { logo: "https://x.test/logo.png" });
  expect(html).toContain('<img src="https://x.test/logo.png"');
});

test("the footer is added even when the layout leaves it out", () => {
  const { html, text } = render("Body");
  expect(html).toContain("Sent by Bogey on behalf of Acme.");
  expect(text).toContain("Sent by Bogey on behalf of Acme.");
});

test("the footer names only the platform when the org is the platform", () => {
  const { text } = renderEmail({
    layout: LAYOUT,
    fallbackLayout: DEFAULT_EMAIL_LAYOUT,
    subject: "s",
    body: "b",
    org: "Bogey",
    platform: "Bogey",
    reason: "a test ran",
    values: {},
  });
  expect(text).toContain("Sent by Bogey.");
  expect(text).not.toContain("on behalf");
});

test("a layout without {{content}} falls back to the default", () => {
  const { html } = render("Body text", {}, "<p>no slot</p>");
  expect(html).not.toContain("no slot");
  expect(html).toContain("Body text");
});

test("a layout can't smuggle the footer or content tokens through values", () => {
  const { html } = render("Hi", { org: "{{content}}{{footer}}" });
  expect(html.match(/Sent by Bogey/g)).toHaveLength(1);
});

test("the subject is rendered on one line", () => {
  const { subject } = renderEmail({
    layout: LAYOUT,
    fallbackLayout: DEFAULT_EMAIL_LAYOUT,
    subject: "Code\n{{code}}",
    body: "b",
    org: "A",
    platform: "B",
    reason: "a test ran",
    values: { code: "1" },
  });
  expect(subject).toBe("Code 1");
});

test("plain text drops the markup but keeps the links", () => {
  const text = markdownToEmailText(
    "# Hello\n\nUse **bold**, [a link](https://x.test) and `code`.\n\n- one\n- two\n\n**[Sign in](https://x.test/in)**",
  );
  expect(text).toContain("Hello");
  expect(text).not.toContain("#");
  expect(text).toContain("a link (https://x.test)");
  expect(text).toContain("Sign in: https://x.test/in");
  expect(text).toContain("- one");
});

test("the default layout works as a layout", () => {
  expect(layoutProblem(DEFAULT_EMAIL_LAYOUT)).toBeNull();
  expect(layoutProblem("<p>nothing</p>")).toMatch(/content/);
  expect(layoutProblem("{{content}}<script>x</script>")).toMatch(/script/);
  const { html } = render("Body", { accent: "#ff0000" }, DEFAULT_EMAIL_LAYOUT);
  expect(html).toContain("Body");
  expect(html).toContain("Sent by Bogey on behalf of Acme.");
  expect(html).not.toContain("{{");
});

test("the footer says why the email was sent, with the person and org filled in", () => {
  const { html, text } = render("Body", { email: "ada@example.com" });
  const why =
    "You're receiving this email because someone asked to sign in to Acme with ada@example.com.";
  expect(html).toContain(why);
  expect(text).toContain(why);
});

test("the reason can't be removed by a layout without a footer or by a template", () => {
  const { html } = render("No reason here", {}, "<main>{{content}}</main>");
  expect(html).toContain("You're receiving this email because");
});

test("the default layout is the light brand: no dark scheme, the accent on the card and button", () => {
  expect(DEFAULT_EMAIL_LAYOUT).not.toContain("prefers-color-scheme: dark");
  expect(DEFAULT_EMAIL_LAYOUT).toContain('content="light only"');
  const { html } = render("**[Go]({{link}})**", { link: "https://x.test" }, DEFAULT_EMAIL_LAYOUT);
  expect(html).toContain("#c2410c");
});

test("without a logo the brand is a mark with the org's initial and its name", () => {
  const { html } = render("Body", {}, DEFAULT_EMAIL_LAYOUT);
  expect(html).toMatch(/line-height:32px">A<\/td>/);
  expect(html).toContain(">Acme</td>");
});

test("an instance's accent replaces the default", () => {
  const { html } = render("Body", { accent: "#2563eb" }, DEFAULT_EMAIL_LAYOUT);
  expect(html).toContain("#2563eb");
  expect(html).not.toContain("#c2410c");
});

test("adds an unsubscribe link to the footer when given one", () => {
  const url = "https://hacks.example.com/api/email/unsubscribe?token=abc";
  const base = {
    layout: "{{content}}{{footer}}",
    fallbackLayout: "{{content}}{{footer}}",
    subject: "Hi",
    body: "Hello",
    values: {},
    org: "Acme",
    platform: "Bogey",
    reason: "you registered",
  };
  const withLink = renderEmail({ ...base, unsubscribeUrl: url });
  expect(withLink.html).toContain(`href="${url}"`);
  expect(withLink.text).toContain(url);
  const without = renderEmail(base);
  expect(without.html).not.toContain("Unsubscribe");
  expect(without.text).not.toContain("Unsubscribe");
});

describe("emails in other languages", () => {
  const fallback = { subject: "Hi", body: "Hello {{event}}" };
  const spanish = { subject: "Hola", body: "Hola {{event}}" };

  test("a template saved for the language wins, then the org's own words, then a translation", () => {
    const saved = {
      "team.joined@es": { subject: "Org ES", body: "x" },
      "team.joined": { subject: "Org", body: "y" },
    };
    expect(pickTemplate(saved, "team.joined", "es", spanish, fallback).subject).toBe("Org ES");
    expect(
      pickTemplate({ "team.joined": saved["team.joined"] }, "team.joined", "es", spanish, fallback)
        .subject,
    ).toBe("Org");
    expect(pickTemplate({}, "team.joined", "es", spanish, fallback).subject).toBe("Hola");
    expect(pickTemplate({}, "team.joined", null, undefined, fallback).subject).toBe("Hi");
  });

  test("English is the unmarked key", () => {
    expect(localizedTemplateKey("signIn", "en")).toBe("signIn");
    expect(localizedTemplateKey("signIn", "es")).toBe("signIn@es");
    expect(localizedTemplateKey("signIn", null)).toBe("signIn");
  });

  test("a translation needs a subject and a body", () => {
    expect(translatedEmail({ "emailTemplate.signIn.subject": "S" }, "signIn")).toBeUndefined();
    expect(
      translatedEmail(
        { "emailTemplate.signIn.subject": "S", "emailTemplate.signIn.body": "B" },
        "signIn",
      ),
    ).toEqual({ subject: "S", body: "B", reason: undefined });
  });

  test("the footer speaks the person's language", () => {
    const footer = footerWords({ "emailFooter.because": "Recibes este correo porque {reason}." });
    const rendered = renderEmail({
      layout: "{{content}}{{footer}}",
      fallbackLayout: "{{content}}",
      subject: "S",
      body: "B",
      values: {},
      org: "Acme",
      platform: "Acme",
      reason: "te inscribiste",
      footer,
      locale: "es",
    });
    expect(rendered.text).toContain("Recibes este correo porque te inscribiste.");
    expect(rendered.text).toContain("Sent by Acme.");
  });
});

test("email markdown follows a feature set and underlines ++text++", () => {
  expect(markdownToEmailHtml("a ++b++ c")).toContain("<u>b</u>");
  const html = markdownToEmailHtml("# Hi\n\n[x](https://x.test)", {
    headings: false,
    links: false,
    lists: true,
    code: true,
    images: false,
  });
  expect(html).not.toContain("<h1");
  expect(html).not.toContain("<a ");
  expect(html).toContain("# Hi");
});
