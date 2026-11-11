import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { useAuth } from "./auth.jsx";

const FacilityContext = createContext(null);
const STORAGE_KEY = "pacsd_facility";

export function FacilityProvider({ children }) {
  const { user, ready: authReady } = useAuth();
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityId] = useState(() => sessionStorage.getItem(STORAGE_KEY) || "");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!authReady) return undefined;
    if (!user) {
      setFacilities([]);
      setReady(true);
      return undefined;
    }
    let cancel = false;
    setReady(false);
    api("/api/facilities")
      .then((data) => {
        if (cancel) return;
        const list = data.facilities || [];
        setFacilities(list);
        const stored = sessionStorage.getItem(STORAGE_KEY);
        const known = list.some((facility) => facility._id === stored);
        const next = known ? stored : list[0]?._id || "";
        if (next) sessionStorage.setItem(STORAGE_KEY, next);
        else sessionStorage.removeItem(STORAGE_KEY);
        setFacilityId(next);
      })
      .catch(() => {
        if (!cancel) setFacilities([]);
      })
      .finally(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [authReady, user]);

  const value = useMemo(() => ({
    facilities,
    facilityId,
    ready,
    setFacility(id) {
      sessionStorage.setItem(STORAGE_KEY, id);
      setFacilityId(id);
    },
  }), [facilities, facilityId, ready]);

  return <FacilityContext.Provider value={value}>{children}</FacilityContext.Provider>;
}

export function useFacility() {
  return useContext(FacilityContext);
}
