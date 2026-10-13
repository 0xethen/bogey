import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";

export type View = "public" | "jury";

export function ViewTabs({
  elevated,
  view,
  onViewChange,
  children,
}: {
  elevated: boolean;
  view: View;
  onViewChange: (view: View) => void;
  children: (view: View) => ReactNode;
}) {
  if (!elevated) return children("public");
  return (
    <Tabs value={view} onValueChange={(next: View) => onViewChange(next)} className="gap-0">
      <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
        <TabsList aria-label="Which view">
          <TabsTrigger value="public">Public view</TabsTrigger>
          <TabsTrigger value="jury">Jury view</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="public">{view === "public" && children("public")}</TabsContent>
      <TabsContent value="jury">{view === "jury" && children("jury")}</TabsContent>
    </Tabs>
  );
}
