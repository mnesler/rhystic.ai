// CardTooltip — global floating card image tooltip.
//
// Mount this once at the app root. It uses event delegation on the document
// to intercept mouseover on any [data-card] element and show the Scryfall
// card image in a floating tooltip next to the cursor.
//
// Image URL format (no API key needed, browser follows redirect to CDN):
//   https://api.scryfall.com/cards/named?exact={name}&format=image&version=normal
//
// One tooltip div is shared across the entire app — no per-card component
// instances. This keeps memory overhead flat regardless of card count.

import { onMount, onCleanup } from "solid-js";

const SCRYFALL_IMG = (name: string) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;

const TOOLTIP_W = 240;  // px — matches the CSS width
const TOOLTIP_H = 336;  // px — approximate card height at normal size (488×680 scaled)
const OFFSET    = 16;   // px — gap between cursor and tooltip edge

export default function CardTooltip() {
  let tooltip!: HTMLDivElement;
  let img!: HTMLImageElement;
  let currentCard = "";

  function getCardName(target: EventTarget | null): string | null {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if (el.dataset?.card) return el.dataset.card;
      el = el.parentElement;
    }
    return null;
  }

  function position(x: number, y: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: right of and slightly above cursor
    let left = x + OFFSET;
    let top  = y - TOOLTIP_H / 2;

    // Clamp: if it would overflow the right edge, flip to the left
    if (left + TOOLTIP_W > vw - 8) {
      left = x - TOOLTIP_W - OFFSET;
    }

    // Clamp: keep inside vertical viewport
    if (top < 8) top = 8;
    if (top + TOOLTIP_H > vh - 8) top = vh - TOOLTIP_H - 8;

    tooltip.style.left = `${left}px`;
    tooltip.style.top  = `${top}px`;
  }

  function show(name: string, x: number, y: number) {
    if (name === currentCard && tooltip.style.display !== "none") {
      position(x, y);
      return;
    }
    currentCard = name;
    img.src = "";                        // cancel any in-flight load
    img.src = SCRYFALL_IMG(name);
    position(x, y);
    tooltip.style.display = "block";
  }

  function hide() {
    tooltip.style.display = "none";
    img.src = "";                        // cancel load to avoid wasted bandwidth
    currentCard = "";
  }

  function onMouseOver(e: MouseEvent) {
    const name = getCardName(e.target);
    if (name) {
      show(name, e.clientX, e.clientY);
    } else if (currentCard) {
      // Moved off a card element onto something else
      hide();
    }
  }

  function onMouseMove(e: MouseEvent) {
    if (currentCard) position(e.clientX, e.clientY);
  }

  function onMouseOut(e: MouseEvent) {
    // Only hide if we're leaving the card element entirely (not moving to a child)
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !getCardName(related)) {
      if (currentCard) hide();
    }
  }

  // Hide when the user scrolls (tooltip position would drift)
  function onScroll() {
    if (currentCard) hide();
  }

  onMount(() => {
    document.addEventListener("mouseover", onMouseOver, { passive: true });
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseout",  onMouseOut,  { passive: true });
    document.addEventListener("scroll",    onScroll,    { passive: true, capture: true });
  });

  onCleanup(() => {
    document.removeEventListener("mouseover", onMouseOver);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseout",  onMouseOut);
    document.removeEventListener("scroll",    onScroll, true);
  });

  return (
    <div
      id="card-tooltip"
      ref={tooltip!}
      style="display:none"
      aria-hidden="true"
    >
      <img
        ref={img!}
        alt=""
        width={TOOLTIP_W}
        onError={() => { tooltip.style.display = "none"; }}
      />
    </div>
  );
}
