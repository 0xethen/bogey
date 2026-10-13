import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import confirmation from "../../../../../../supabase/templates/confirmation.html?raw";
import emailChange from "../../../../../../supabase/templates/email_change.html?raw";
import invite from "../../../../../../supabase/templates/invite.html?raw";
import magicLink from "../../../../../../supabase/templates/magic_link.html?raw";
import reauthentication from "../../../../../../supabase/templates/reauthentication.html?raw";
import recovery from "../../../../../../supabase/templates/recovery.html?raw";

const TEMPLATES: Record<string, string> = {
  confirmation,
  email_change: emailChange,
  invite,
  magic_link: magicLink,
  reauthentication,
  recovery,
};

export const Route = createFileRoute("/api/auth/email-templates/$name")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const template = TEMPLATES[params.name.replace(/\.html$/, "")];
        if (!template) return new Response("No such template", { status: 404 });
        return new Response(template, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=300" },
        });
      },
    },
  },
});
