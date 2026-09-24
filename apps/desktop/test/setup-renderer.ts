/**
 * Les tests du renderer attendent des rendus React sous jsdom. Le délai par défaut de Testing
 * Library (1 s) suffit à vide, mais pas quand toute la suite tourne en parallèle : les attentes
 * expiraient par intermittence, produisant des échecs sans rapport avec le code testé.
 */
import { configure } from "@testing-library/dom";

configure({ asyncUtilTimeout: 10_000 });
