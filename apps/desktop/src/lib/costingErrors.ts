import {
  ArchivedReferenceError,
  CircularDependencyError,
  ExcessiveNestingError,
  IncompatibleUnitError,
  InvalidYieldError,
  MissingIngredientCostError,
  UnknownUnitError,
} from "@pastry-management/core";
import { toAppError } from "../api/errors";

/**
 * Translates the costing engine's 7 typed error classes (see packages/core/src/costing/errors.ts)
 * into their already-descriptive `.message` (e.g. CircularDependencyError names the exact cycle
 * path), and falls back to the app's usual `{ message, field }` rejection shape for errors thrown
 * by the `get_recipe_costing_graph` Tauri call itself.
 *
 * Shared between RecipeDetail (recipes screen) and CostCalculatorScreen, which both run the same
 * client-side calculation against the same costing graph and need to present the same errors.
 */
export function describeCostingError(err: unknown): string {
  if (
    err instanceof CircularDependencyError ||
    err instanceof MissingIngredientCostError ||
    err instanceof ArchivedReferenceError ||
    err instanceof ExcessiveNestingError ||
    err instanceof InvalidYieldError ||
    err instanceof IncompatibleUnitError ||
    err instanceof UnknownUnitError
  ) {
    return err.message;
  }
  return toAppError(err).message;
}
