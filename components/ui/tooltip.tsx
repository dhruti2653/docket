"use client";

import {
  arrow,
  autoUpdate,
  FloatingArrow,
  FloatingDelayGroup,
  FloatingPortal,
  flip,
  offset,
  type Placement,
  shift,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from "@floating-ui/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Slot } from "@/lib/slot";
import { cn } from "@/lib/utils";

// Floating UI for behaviour, daisyUI's tooltip *appearance* for the bubble. The
// `tooltip` class is unusable here — positioned inside a `.tooltip` ancestor and
// revealed on `:hover`, it can't be portalled, can't flip, has no controlled
// state. So its look is reproduced below through the same theme tokens.
type Side = "bottom" | "left" | "right" | "top";

function TooltipProvider({
  children,
  delayDuration = 0,
}: {
  children: ReactNode;
  delayDuration?: number;
}) {
  return (
    <FloatingDelayGroup delay={{ close: 150, open: delayDuration }}>
      {children}
    </FloatingDelayGroup>
  );
}

interface TooltipContextValue {
  arrowRef: React.RefObject<SVGSVGElement | null>;
  context: ReturnType<typeof useFloating>["context"];
  getFloatingProps: ReturnType<typeof useInteractions>["getFloatingProps"];
  getReferenceProps: ReturnType<typeof useInteractions>["getReferenceProps"];
  isMounted: boolean;
  refs: ReturnType<typeof useFloating>["refs"];
  setPlacement: (placement: Placement) => void;
  styles: React.CSSProperties;
  transitionStyles: React.CSSProperties;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

function useTooltipContext(name: string) {
  const context = useContext(TooltipContext);
  if (!context) {
    throw new Error(`<${name}> must be rendered inside <Tooltip>`);
  }
  return context;
}

function Tooltip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("top");
  const arrowRef = useRef<SVGSVGElement>(null);

  const { context, floatingStyles, refs } = useFloating({
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
    onOpenChange: setOpen,
    open,
    placement,
    // Position via left/top, not `transform: translate(...)` — the scale-in
    // below (useTransitionStyles) also writes `transform` and, spread after
    // these styles on TooltipContent, would wipe the translate and pin every
    // tooltip to the viewport's top-left corner.
    transform: false,
    whileElementsMounted: autoUpdate,
  });

  const { delay, isInstantPhase } = useDelayGroup(context);
  const hover = useHover(context, { delay, move: false });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getFloatingProps, getReferenceProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: isInstantPhase ? 0 : 100,
    initial: { opacity: 0, transform: "scale(0.95)" },
  });

  return (
    <TooltipContext.Provider
      value={{
        arrowRef,
        context,
        getFloatingProps,
        getReferenceProps,
        isMounted,
        refs,
        setPlacement,
        styles: floatingStyles,
        transitionStyles,
      }}
    >
      {children}
    </TooltipContext.Provider>
  );
}

function TooltipTrigger({
  asChild,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const { getReferenceProps, refs } = useTooltipContext("TooltipTrigger");
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="tooltip-trigger"
      ref={refs.setReference}
      {...getReferenceProps(props)}
    />
  );
}

function TooltipContent({
  className,
  side = "top",
  children,
  ...props
}: React.ComponentProps<"div"> & { side?: Side }) {
  const {
    arrowRef,
    context,
    getFloatingProps,
    isMounted,
    refs,
    setPlacement,
    styles,
    transitionStyles,
  } = useTooltipContext("TooltipContent");

  useLayoutEffect(() => {
    setPlacement(side);
  }, [side, setPlacement]);

  if (!isMounted) {
    return null;
  }

  return (
    <FloatingPortal>
      <div
        className={cn(
          "z-50 inline-flex w-fit max-w-80 items-center gap-1.5 rounded-field bg-sidebar px-2 py-1 text-sm text-sidebar-content",
          className
        )}
        data-slot="tooltip-content"
        ref={refs.setFloating}
        style={{ ...styles, ...transitionStyles }}
        {...getFloatingProps(props)}
      >
        {children}
        <FloatingArrow
          className="fill-sidebar"
          context={context}
          ref={arrowRef}
        />
      </div>
    </FloatingPortal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
