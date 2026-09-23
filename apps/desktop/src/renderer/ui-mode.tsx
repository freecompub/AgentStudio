import { createContext, useContext } from "react";
import type { UiMode } from "../shared/ipc-contract";

/** Mode d'affichage (§11) : simple pour les non-développeurs, avancé pour le détail technique. */
export const UiModeContext = createContext<UiMode>("simple");
export const useUiMode = () => useContext(UiModeContext);
export const useAdvanced = () => useContext(UiModeContext) === "advanced";
