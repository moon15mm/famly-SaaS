"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { api, Product, User } from "@/lib/api";
export type Line = { product: Product; quantity: number; option_id?: string };
export const lineKey = (x: Line) =>
  x.product.id + (x.option_id ? ":" + x.option_id : "");
export const linePrice = (x: Line) =>
  x.product.price +
  (x.product.options?.find((o) => o.id === x.option_id)?.price_delta || 0);
export const optionLabel = (x: Line) =>
  x.product.options?.find((o) => o.id === x.option_id)?.name || "";
type Context = {
  user: User | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  cart: Line[];
  add: (p: Product, qty?: number, optionId?: string) => void;
  quantity: (id: string, qty: number) => void;
  clear: () => void;
  toast: (message: string) => void;
};
const StoreContext = createContext<Context>(null!);
export const useStore = () => useContext(StoreContext);
export function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loaded, setLoaded] = useState(false),
    [cart, setCart] = useState<Line[]>([]),
    [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try {
      setUser(await api<User>("/auth/me"));
    } catch {
      setUser(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    refresh();
    try {
      const saved = JSON.parse(localStorage.getItem("buyutna-cart") || "[]");
      if (
        Array.isArray(saved) &&
        saved.every(
          (x) =>
            x.product?.id && Number.isInteger(x.quantity) && x.quantity > 0,
        )
      )
        setCart(saved);
    } catch {
      localStorage.removeItem("buyutna-cart");
    }
  }, [refresh]);
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [message]);
  function save(lines: Line[]) {
    setCart(lines);
    localStorage.setItem("buyutna-cart", JSON.stringify(lines));
  }
  function add(p: Product, qty = 1, optionId = "") {
    if (p.options?.length && !p.options.some((o) => o.id === optionId)) {
      setMessage("اختر أحد خيارات المنتج من صفحته أولًا");
      return;
    }
    if (cart.some((x) => x.product.household_id !== p.household_id)) {
      setMessage(
        "أكمل طلب الأسرة الحالية أو أفرغ السلة قبل الطلب من أسرة أخرى",
      );
      return;
    }
    const candidate: Line = { product: p, quantity: qty, option_id: optionId };
    const old = cart.find((x) => lineKey(x) === lineKey(candidate));
    if (
      cart
        .filter((x) => x.product.id === p.id)
        .reduce((s, x) => s + x.quantity, 0) +
        qty >
      p.stock
    ) {
      setMessage("الكمية المطلوبة غير متوفرة");
      return;
    }
    save(
      old
        ? cart.map((x) =>
            lineKey(x) === lineKey(candidate)
              ? { ...x, quantity: x.quantity + qty }
              : x,
          )
        : [...cart, candidate],
    );
    setMessage("أُضيف إلى سلتك بكل حب");
  }
  return (
    <StoreContext.Provider
      value={{
        user,
        loaded,
        refresh,
        cart,
        add,
        quantity: (id, qty) =>
          save(
            cart
              .map((x) =>
                lineKey(x) === id
                  ? {
                      ...x,
                      quantity: Math.min(
                        qty,
                        x.product.stock -
                          cart
                            .filter(
                              (y) =>
                                y.product.id === x.product.id &&
                                lineKey(y) !== id,
                            )
                            .reduce((s, y) => s + y.quantity, 0),
                      ),
                    }
                  : x,
              )
              .filter((x) => x.quantity > 0),
          ),
        clear: () => save([]),
        toast: setMessage,
      }}
    >
      {children}
      <div
        className={"toast " + (message ? "visible" : "")}
        role="status"
        aria-live="polite"
      >
        {message}
      </div>
    </StoreContext.Provider>
  );
}
