import type { ComponentProps } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@bogey/ui/lib/utils";
import { DialogContent, DialogTitle } from "./dialog.tsx";

function CreateDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      data-slot="create-dialog-content"
      className={cn(
        "flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)] md:max-w-[calc(100%-2rem)] lg:max-w-4xl",
        className,
      )}
      {...props}
    />
  );
}

function CreateDialogLayout({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      {
        className: cn(
          "grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_19rem] md:overflow-hidden",
          className,
        ),
      },
      props,
    ),
    state: { slot: "create-dialog-layout" },
  });
}

function CreateDialogMain({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="create-dialog-main"
      className={cn("flex min-w-0 flex-col gap-4 p-6 md:overflow-y-auto", className)}
      {...props}
    />
  );
}

function CreateDialogSide({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="create-dialog-side"
      className={cn(
        "flex flex-col gap-5 border-t border-border bg-muted/40 p-6 md:overflow-y-auto md:border-t-0 md:border-l md:pt-16",
        className,
      )}
      {...props}
    />
  );
}

function CreateDialogTitle({ className, ...props }: ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      className={cn("pr-10 text-sm font-medium text-muted-fg md:pr-0", className)}
      {...props}
    />
  );
}

function CreateDialogHeadline({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="create-dialog-headline"
      className={cn(
        "w-full border-b border-transparent bg-transparent pb-1 font-heading text-2xl font-medium tracking-tight outline-none placeholder:text-muted-fg/60 focus-visible:border-ring focus-visible:outline-none aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

function CreateDialogActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="create-dialog-actions"
      className={cn("mt-auto flex flex-col gap-2 pt-2", className)}
      {...props}
    />
  );
}

export {
  CreateDialogActions,
  CreateDialogContent,
  CreateDialogHeadline,
  CreateDialogLayout,
  CreateDialogMain,
  CreateDialogSide,
  CreateDialogTitle,
};
