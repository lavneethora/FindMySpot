import { useCallback, useEffect, useState } from "react";

/**
 * Two routes, no parameters, no nesting.
 *
 * Hand rolled rather than pulling in a router: the whole need is "which of two views", and a
 * routing library would be more dependency and more bundle than the views themselves. If a
 * third route with parameters ever appears, throw this away and install one.
 */
export type Route = "driver" | "ops";

export function routeOf(pathname: string): Route {
  return pathname.replace(/\/+$/, "") === "/ops" ? "ops" : "driver";
}

export function pathOf(route: Route): string {
  return route === "ops" ? "/ops" : "/";
}

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? "driver" : routeOf(window.location.pathname),
  );

  // Back and forward have to work, or the operator view becomes a trap on a laptop where the
  // browser chrome is the only navigation on screen.
  useEffect(() => {
    const sync = () => setRoute(routeOf(window.location.pathname));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (typeof window !== "undefined" && routeOf(window.location.pathname) !== next) {
      window.history.pushState(null, "", pathOf(next));
    }
    setRoute(next);
  }, []);

  return [route, navigate];
}
