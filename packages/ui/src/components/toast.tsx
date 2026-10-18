import * as React from "react";
import { useUiText } from "../lib/ui-text.ts";
import {
  Toast as ToastPrimitive,
  type ToastManager,
  type ToastManagerAddOptions,
  type ToastObject,
} from "@base-ui/react/toast";
import { cn } from "@bogey/ui/lib/utils";
import { Button } from "@bogey/ui/components/button";
import {
  IconX,
  IconCircleCheck,
  IconInfoCircle,
  IconAlertTriangle,
  IconAlertOctagon,
  IconLoader,
} from "@tabler/icons-react";

// don't worry about all of the nonsense, it's just recreating
// things like the positioner, stack layout, and dismiss timer
// so that we can "access" it
// https://github.com/mui/base-ui/tree/v1.9.0/packages/react/src/toast

// we shouldve just used sonner tbh

type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

type ToastData = { position?: ToastPosition; wide?: boolean };

const toastprimitive = ToastPrimitive.createToastManager<ToastData>();

// add position to toast.add data
const toast = {
  ...toastprimitive,
  add: ({ position, wide, ...options }: ToastManagerAddOptions<ToastData> & ToastData) =>
    toastprimitive.add({ ...options, data: { ...options.data, position, wide } }),
};

const swipeDirections = {
  "top-left": ["up", "left"],
  "top-center": ["up"],
  "top-right": ["up", "right"],
  "bottom-left": ["down", "left"],
  "bottom-center": ["down"],
  "bottom-right": ["down", "right"],
} satisfies Record<ToastPosition, ToastPrimitive.Root.Props["swipeDirection"]>;

const toastPositions: Record<ToastPosition, string> = {
  "top-left": "top-0 origin-top [--sign:1] after:bottom-full sm:right-auto sm:mx-0",
  "top-center": "top-0 origin-top [--sign:1] after:bottom-full",
  "top-right": "top-0 origin-top [--sign:1] after:bottom-full sm:left-auto sm:mx-0",
  "bottom-left": "bottom-0 origin-bottom [--sign:-1] after:top-full sm:right-auto sm:mx-0",
  "bottom-center": "bottom-0 origin-bottom [--sign:-1] after:top-full",
  "bottom-right": "bottom-0 origin-bottom [--sign:-1] after:top-full sm:left-auto sm:mx-0",
};

function stackLayout(toasts: Tuple<ToastObject<ToastData>>, fallback: ToastPosition) {
  const stacks = new Map<
    ToastPosition,
    { visible: number; dom: number; offsetY: number; frontmostHeight: number | undefined }
  >();

  return new Map(
    toasts.map((toastItem) => {
      const position = toastItem.data?.position ?? fallback;
      const stack = stacks.get(position) ?? {
        visible: 0,
        dom: 0,
        offsetY: 0,
        frontmostHeight: toastItem.height,
      };
      const ending = toastItem.transitionStatus === "ending";
      const layout = {
        position,
        style: {
          "--stack-index": ending ? stack.dom : stack.visible,
          "--stack-offset-y": `${stack.offsetY}px`,
          "--stack-frontmost-height": stack.frontmostHeight
            ? `${stack.frontmostHeight}px`
            : undefined,
        } as React.CSSProperties,
      };

      stack.dom += 1;
      stack.offsetY += toastItem.height ?? 0;
      if (!ending) stack.visible += 1;
      stacks.set(position, stack);

      return [toastItem.id, layout];
    }),
  );
}

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn("pointer-events-none fixed inset-4 z-50 outline-none", className)}
      {...props}
    />
  );
}

function Toast({
  className,
  position = "bottom-right",
  ...props
}: ToastPrimitive.Root.Props & { position?: ToastPosition }) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      data-position={position}
      swipeDirection={swipeDirections[position]}
      className={cn(
        "group/toast pointer-events-auto absolute inset-x-0 z-[calc(1000-var(--stack-index))] mx-auto w-full max-w-sm rounded-2xl border bg-popover text-popover-fg shadow-lg will-change-transform select-none focus-visible:border-ring",
        "[--stack-frontmost-height:var(--toast-frontmost-height)] [--stack-index:var(--toast-index)] [--stack-offset-y:var(--toast-offset-y)]",
        toastPositions[position],
        "[--gap:0.75rem] [--height:var(--stack-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--sign)*(var(--stack-offset-y)+var(--stack-index)*var(--gap))+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--stack-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+var(--sign)*(var(--stack-index)*var(--peek)+var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:transform-[translateY(calc(var(--sign)*-150%))]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:transform-[translateY(calc(var(--sign)*-150%))]",
        "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "relative flex h-full items-center gap-3 overflow-hidden p-4 pb-5 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-fg", className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  const t = useUiText();
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label={t("ui.closeToast")}
      render={render}
      className={cn(
        "relative shrink-0 text-muted-fg after:absolute after:-inset-2 after:content-[''] hover:text-fg",
        className,
      )}
      {...props}
    >
      {children ?? <IconX aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null;

  if (type === "success") icon = <IconCircleCheck aria-hidden="true" />;
  if (type === "info") icon = <IconInfoCircle aria-hidden="true" />;
  if (type === "warning") icon = <IconAlertTriangle aria-hidden="true" />;
  if (type === "error") icon = <IconAlertOctagon className="text-destructive" aria-hidden="true" />;
  if (type === "loading") icon = <IconLoader className="animate-spin" aria-hidden="true" />;

  if (!icon) return null;

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  );
}

function ToastProgressBar({
  duration,
  restart,
  windowBlurred,
}: {
  duration: number;
  restart: string;
  windowBlurred: boolean;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 mx-auto h-1 w-[95%] overflow-hidden rounded-b-full bg-primary/50">
      <div
        key={restart}
        data-window-blurred={windowBlurred || undefined}
        className="h-full origin-left animate-[toast-progress_linear_forwards] bg-primary group-data-expanded/toast:[animation-play-state:paused] data-window-blurred:[animation-play-state:paused]"
        style={{ animationDuration: `${duration}ms` }}
      />
    </div>
  );
}

/** Mirrors the store's `isWindowFocused`, which pauses every timer on blur. */
function useWindowBlurred() {
  const [blurred, setBlurred] = React.useState(false);

  React.useEffect(() => {
    const onBlur = (event: FocusEvent) => {
      if (event.target === window) setBlurred(true);
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target === window) setBlurred(false);
    };
    window.addEventListener("blur", onBlur, true);
    window.addEventListener("focus", onFocus, true);
    return () => {
      window.removeEventListener("blur", onBlur, true);
      window.removeEventListener("focus", onFocus, true);
    };
  }, []);

  return blurred;
}

function useTimerRestarts(toastManager: ToastManager) {
  const [restarts, setRestarts] = React.useState<ReadonlyMap<string, number>>(new Map());

  React.useEffect(
    () =>
      toastManager[" subscribe"]((event) => {
        const options: unknown = event.options;
        if (typeof options !== "object" || options === null) return;
        if (!("id" in options) || typeof options.id !== "string") return;

        const restartsTimer =
          event.action === "add" ||
          (event.action === "update" &&
            "updates" in options &&
            typeof options.updates === "object" &&
            options.updates !== null &&
            Object.hasOwn(options.updates, "timeout"));
        if (!restartsTimer) return;

        const id = options.id;
        setRestarts((prev) => new Map(prev).set(id, (prev.get(id) ?? 0) + 1));
      }),
    [toastManager],
  );

  return restarts;
}

function ToastList({
  position,
  timeout,
  toastManager,
}: {
  position: ToastPosition;
  timeout: number;
  toastManager: ToastManager;
}) {
  const { toasts } = ToastPrimitive.useToastManager<ToastData>();
  const windowBlurred = useWindowBlurred();
  const restarts = useTimerRestarts(toastManager);
  const layouts = stackLayout(toasts, position);

  return toasts.map((toastItem) => {
    const duration = toastItem.timeout ?? timeout;
    const hasTimer = toastItem.type !== "loading" && duration > 0;
    const layout = layouts.get(toastItem.id);

    return (
      <Toast
        key={toastItem.id}
        toast={toastItem}
        position={layout?.position ?? position}
        style={layout?.style}
        className={toastItem.data?.wide ? "max-w-md" : undefined}
      >
        <ToastContent>
          <ToastIcon type={toastItem.type} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ToastTitle />
            <ToastDescription />
          </div>
          <ToastAction />
          <ToastClose />
          {hasTimer && (
            <ToastProgressBar
              duration={duration}
              restart={`${duration}-${restarts.get(toastItem.id) ?? 0}`}
              windowBlurred={windowBlurred}
            />
          )}
        </ToastContent>
      </Toast>
    );
  });
}

function Toaster({
  children,
  toastManager = toast,
  timeout = 5000,
  position = "bottom-right",
  ...props
}: ToastPrimitive.Provider.Props & { position?: ToastPosition }) {
  return (
    <ToastProvider toastManager={toastManager} timeout={timeout} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList position={position} timeout={timeout} toastManager={toastManager} />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
export type { ToastPosition };
