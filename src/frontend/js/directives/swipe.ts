import type { Directive } from "vue";

type SwipeValue = {
  navigate: (side: number) => boolean | void;
  peek: (side: number) => boolean;
  selected: unknown;
  loaded: unknown;
};

const EDGE = 24;
const LOCK = 10;
const MIN_TRAVEL = 80;
const MIN_RATIO = 0.25;
const DURATION = 180;
const LOAD_TIMEOUT = 3000;
const RESISTANCE = 3;

const hooks = new WeakMap<
  HTMLElement,
  { update: (value: SwipeValue) => void; destroy: () => void }
>();

function scrollsHorizontally(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el.scrollWidth > el.clientWidth) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

export default {
  mounted(el, binding) {
    const col = el.parentElement!;
    let current = binding.value;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let swiping: boolean | null = false;
    let side = 0;
    let hasNeighbour = false;
    let busy = false;
    let origin: unknown = null;
    let pending: { loaded: unknown; timer: number } | null = null;
    let destroyed = false;
    const timers = new Set<number>();

    const setOffset = (x: number) => col.style.setProperty("--swipe-dx", `${x}px`);

    const animateTo = (x: number) => {
      col.classList.add("swipe-animate");
      setOffset(x);
      return new Promise<void>(resolve => {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          if (!destroyed) resolve();
        }, DURATION);
        timers.add(timer);
      });
    };

    const finish = () => {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      col.classList.remove("swiping", "swipe-animate");
      col.style.removeProperty("--swipe-dx");
      current.peek(0);
      side = 0;
      busy = false;
    };

    const cancel = () => {
      busy = true;
      animateTo(0).then(finish);
    };

    hooks.set(el, {
      update: value => {
        current = value;
        if (swiping && value.selected !== origin) {
          swiping = false;
          cancel();
        }
        if (pending && value.loaded !== pending.loaded) finish();
      },
      destroy: () => {
        destroyed = true;
        timers.forEach(clearTimeout);
        finish();
      },
    });

    el.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        if (swiping) cancel();
        swiping = false;
        if (busy || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
        if (scrollsHorizontally(e.target, el)) return;
        if (!window.getSelection()?.isCollapsed) return;
        startX = t.clientX;
        startY = t.clientY;
        dx = 0;
        swiping = null;
      },
      { passive: true },
    );

    el.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        if (swiping === false) return;
        if (e.touches.length !== 1) {
          if (swiping) cancel();
          swiping = false;
          return;
        }
        const t = e.touches[0];
        dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (swiping === null) {
          if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
          swiping = Math.abs(dx) > Math.abs(dy) * 1.5;
          if (!swiping) return;
          origin = current.selected;
          col.classList.add("swiping");
          col.style.setProperty("--swipe-top", `${el.offsetTop}px`);
        }
        e.preventDefault();
        const newSide = dx < 0 ? +1 : -1;
        if (newSide !== side) {
          side = newSide;
          hasNeighbour = current.peek(side);
        }
        setOffset(hasNeighbour ? dx : dx / RESISTANCE);
      },
      { passive: false },
    );

    el.addEventListener("touchend", () => {
      if (!swiping) return;
      swiping = false;
      if (!hasNeighbour || Math.abs(dx) < Math.max(MIN_TRAVEL, el.clientWidth * MIN_RATIO)) {
        cancel();
        return;
      }
      busy = true;
      const target = side;
      animateTo(-target * el.clientWidth).then(() => {
        if (current.selected !== origin) {
          finish();
          return;
        }
        const loaded = current.loaded;
        if (current.navigate(target) === false) {
          cancel();
          return;
        }
        pending = { loaded, timer: window.setTimeout(finish, LOAD_TIMEOUT) };
      });
    });

    el.addEventListener("touchcancel", () => {
      if (!swiping) return;
      swiping = false;
      cancel();
    });
  },
  updated(el, binding) {
    hooks.get(el)?.update(binding.value);
  },
  beforeUnmount(el) {
    hooks.get(el)?.destroy();
    hooks.delete(el);
  },
} satisfies Directive<HTMLElement, SwipeValue>;
