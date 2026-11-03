import { create } from "zustand";

/**
 * Tema claro / oscuro / sistema (BASE §4). Pone o saca `.dark` en <html> y lo recuerda en localStorage.
 * index.html aplica lo mismo antes del primer render (misma clave y misma lógica: si tocás una, tocá la otra).
 * El portal del celular (iframe, mismo origen) sigue al panel por el evento `storage`.
 */
export type Tema = "claro" | "oscuro" | "sistema";
export type TemaResuelto = "claro" | "oscuro";

export const CLAVE_TEMA = "mediflow-tema";

const mq = () =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

// Todas las vistas usan tokens (rediseño terminado, BASE §9.4): el default sigue al sistema y el
// selector está en el header (SelectorTema, components/layout/partes-shell.tsx).
const TEMA_POR_DEFECTO: Tema = "sistema";

function leer(): Tema {
  try {
    const t = localStorage.getItem(CLAVE_TEMA);
    return t === "claro" || t === "oscuro" || t === "sistema" ? t : TEMA_POR_DEFECTO;
  } catch {
    return TEMA_POR_DEFECTO;
  }
}

const resolver = (t: Tema): TemaResuelto => (t === "sistema" ? (mq()?.matches ? "oscuro" : "claro") : t);

function aplicar(r: TemaResuelto) {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("dark", r === "oscuro");
}

interface TemaState {
  tema: Tema;
  resuelto: TemaResuelto;
  setTema: (t: Tema) => void;
}

const useTemaStore = create<TemaState>((set) => {
  const tema = leer();
  return {
    tema,
    resuelto: resolver(tema),
    setTema: (t) => {
      try {
        localStorage.setItem(CLAVE_TEMA, t);
      } catch {
        /* modo privado: queda solo en memoria */
      }
      const resuelto = resolver(t);
      aplicar(resuelto);
      set({ tema: t, resuelto });
    },
  };
});

if (typeof window !== "undefined") {
  aplicar(useTemaStore.getState().resuelto);
  // El sistema cambió (atardecer, ajuste del SO): solo importa si el tema es "sistema".
  mq()?.addEventListener("change", () => {
    const { tema } = useTemaStore.getState();
    if (tema !== "sistema") return;
    const resuelto = resolver(tema);
    aplicar(resuelto);
    useTemaStore.setState({ resuelto });
  });
  // Otra pestaña o el iframe del portal cambió el tema.
  window.addEventListener("storage", (e) => {
    if (e.key !== CLAVE_TEMA) return;
    const tema = leer();
    const resuelto = resolver(tema);
    aplicar(resuelto);
    useTemaStore.setState({ tema, resuelto });
  });
}

/** `const { tema, resuelto, setTema } = useTema()` */
export function useTema() {
  const tema = useTemaStore((s) => s.tema);
  const resuelto = useTemaStore((s) => s.resuelto);
  const setTema = useTemaStore((s) => s.setTema);
  return { tema, resuelto, setTema };
}
