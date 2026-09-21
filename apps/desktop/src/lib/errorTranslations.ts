import type { Locale } from "./i18n";

/**
 * Translates the fixed, enumerable set of Rust `AppError` validation messages into Greek. This is
 * separate from the `t()` dictionary in `i18n.tsx` because these strings originate in the Rust
 * backend (src-tauri/src/**\/*.rs), not as frontend copy — there is no key to look up, only the
 * English text itself, matched exactly or by pattern.
 *
 * Deliberately does NOT attempt to translate everything: messages that wrap an arbitrary lower-
 * level error (`e.to_string()` on a raw rusqlite/reqwest/IO error) are unbounded and can't be
 * covered by a lookup table, so they're left in English — see the `PATTERN_RULES` comment below
 * for the ones that partially translate a known prefix while preserving that unpredictable tail.
 * A message with no match here (including one from a new Rust error added later without updating
 * this file) is returned unchanged, which is a silent English fallback rather than a crash — an
 * intentional trade-off given there is no automated way to keep this file in lockstep with every
 * `AppError::new`/`AppError::field` call site.
 */

const EXACT_TRANSLATIONS: Record<string, string> = {
  "You must be signed in to do that.": "Πρέπει να έχετε συνδεθεί για να το κάνετε αυτό.",
  "Only an owner or admin can create new user accounts.":
    "Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να δημιουργήσει νέους λογαριασμούς χρηστών.",
  "Set your Dropbox App Key in Settings before connecting.":
    "Ορίστε το App Key του Dropbox στις Ρυθμίσεις πριν συνδεθείτε.",
  "Not connected — connect your Dropbox account first.":
    "Δεν είναι συνδεδεμένο — συνδέστε πρώτα τον λογαριασμό σας στο Dropbox.",
  "Invalid backup file path.": "Μη έγκυρη διαδρομή αρχείου αντιγράφου ασφαλείας.",
  "No update available to download — check for updates first.":
    "Δεν υπάρχει διαθέσιμη ενημέρωση για λήψη — ελέγξτε πρώτα για ενημερώσεις.",
  "No update to install — check for updates first.":
    "Δεν υπάρχει ενημέρωση για εγκατάσταση — ελέγξτε πρώτα για ενημερώσεις.",
  "Update has not been downloaded yet.": "Η ενημέρωση δεν έχει ληφθεί ακόμη.",
  "Retention count must be at least 1.": "Ο αριθμός διατήρησης πρέπει να είναι τουλάχιστον 1.",
  "Frequency must be 'daily' or 'weekly'.":
    "Η συχνότητα πρέπει να είναι «ημερήσια» ή «εβδομαδιαία».",
  "Category name is required.": "Το όνομα κατηγορίας είναι υποχρεωτικό.",
  "This category is used by one or more raw materials and cannot be deleted. Archive it instead.":
    "Αυτή η κατηγορία χρησιμοποιείται από μία ή περισσότερες πρώτες ύλες και δεν μπορεί να διαγραφεί. Αρχειοθετήστε την αντ' αυτού.",
  "Quantity must be greater than zero.": "Η ποσότητα πρέπει να είναι μεγαλύτερη από μηδέν.",
  "Total price cannot be negative.": "Η συνολική τιμή δεν μπορεί να είναι αρνητική.",
  "Selected raw material does not exist.": "Η επιλεγμένη πρώτη ύλη δεν υπάρχει.",
  "Selected supplier does not exist.": "Ο επιλεγμένος προμηθευτής δεν υπάρχει.",
  "Raw material name is required.": "Το όνομα της πρώτης ύλης είναι υποχρεωτικό.",
  "Pricing strategy must be one of: latest, average_n, manual.":
    "Η στρατηγική τιμολόγησης πρέπει να είναι μία από: τελευταία τιμή, μέσος όρος, χειροκίνητη.",
  "Selected category does not exist.": "Η επιλεγμένη κατηγορία δεν υπάρχει.",
  "This raw material has purchase history and cannot be deleted. Archive it instead.":
    "Αυτή η πρώτη ύλη έχει ιστορικό αγορών και δεν μπορεί να διαγραφεί. Αρχειοθετήστε την αντ' αυτού.",
  "Ingredient quantity must be greater than zero.":
    "Η ποσότητα του συστατικού πρέπει να είναι μεγαλύτερη από μηδέν.",
  "Raw material ingredient is missing a material.":
    "Το συστατικό τύπου πρώτης ύλης δεν έχει καθορισμένη πρώτη ύλη.",
  "Recipe ingredient is missing a sub-recipe.":
    "Το συστατικό τύπου συνταγής δεν έχει καθορισμένη υπο-συνταγή.",
  "A recipe cannot use itself as an ingredient.":
    "Μια συνταγή δεν μπορεί να χρησιμοποιεί τον εαυτό της ως συστατικό.",
  "Selected sub-recipe does not exist.": "Η επιλεγμένη υπο-συνταγή δεν υπάρχει.",
  "That recipe is archived and can't be used as an ingredient in a new or edited recipe.":
    "Αυτή η συνταγή είναι αρχειοθετημένη και δεν μπορεί να χρησιμοποιηθεί ως συστατικό σε νέα ή επεξεργασμένη συνταγή.",
  "Recipe name is required.": "Το όνομα της συνταγής είναι υποχρεωτικό.",
  "Yield must be greater than zero.": "Η απόδοση πρέπει να είναι μεγαλύτερη από μηδέν.",
  "A recipe needs at least one ingredient.": "Μια συνταγή χρειάζεται τουλάχιστον ένα συστατικό.",
  "This recipe is used as an ingredient elsewhere or has cost history and cannot be deleted. Archive it instead.":
    "Αυτή η συνταγή χρησιμοποιείται ως συστατικό αλλού ή έχει ιστορικό κόστους και δεν μπορεί να διαγραφεί. Αρχειοθετήστε την αντ' αυτού.",
  "Supplier name is required.": "Το όνομα του προμηθευτή είναι υποχρεωτικό.",
  "Enter a valid email address.": "Εισαγάγετε μια έγκυρη διεύθυνση email.",
  "This supplier has purchase history or linked raw materials and cannot be deleted. Archive it instead.":
    "Αυτός ο προμηθευτής έχει ιστορικό αγορών ή συνδεδεμένες πρώτες ύλες και δεν μπορεί να διαγραφεί. Αρχειοθετήστε τον αντ' αυτού.",
  "Username is required.": "Το όνομα χρήστη είναι υποχρεωτικό.",
  "Username must be 64 characters or fewer.": "Το όνομα χρήστη πρέπει να έχει έως 64 χαρακτήρες.",
  "An owner account already exists. Use an existing account to sign in.":
    "Υπάρχει ήδη λογαριασμός ιδιοκτήτη. Χρησιμοποιήστε έναν υπάρχοντα λογαριασμό για σύνδεση.",
  "Role must be owner, admin, or employee.":
    "Ο ρόλος πρέπει να είναι ιδιοκτήτης, διαχειριστής ή υπάλληλος.",
  "That username is already taken.": "Αυτό το όνομα χρήστη χρησιμοποιείται ήδη.",
  "Incorrect username or password.": "Λανθασμένο όνομα χρήστη ή κωδικός.",
  "This account has been deactivated.": "Αυτός ο λογαριασμός έχει απενεργοποιηθεί.",
  "User not found.": "Ο χρήστης δεν βρέθηκε.",
  "Current password is incorrect.": "Ο τρέχων κωδικός είναι λανθασμένος.",
  "no purchase history recorded": "δεν έχει καταγραφεί ιστορικό αγορών",
  "manual override price": "χειροκίνητη τιμή",
};

interface PatternRule {
  pattern: RegExp;
  translate: (match: RegExpMatchArray) => string;
}

const PATTERN_RULES: PatternRule[] = [
  {
    pattern: /^A category named '(.+)' already exists\.$/,
    translate: (m) => `Υπάρχει ήδη κατηγορία με το όνομα «${m[1]}».`,
  },
  {
    pattern: /^Category (\d+) was not found\.$/,
    translate: (m) => `Η κατηγορία ${m[1]} δεν βρέθηκε.`,
  },
  {
    pattern: /^'(.+)' is not a known measurement unit\.$/,
    translate: (m) => `Το «${m[1]}» δεν είναι γνωστή μονάδα μέτρησης.`,
  },
  {
    pattern: /^Raw material (\d+) was not found\.$/,
    translate: (m) => `Η πρώτη ύλη ${m[1]} δεν βρέθηκε.`,
  },
  {
    pattern: /^Unknown ingredient type '(.+)'\.$/,
    translate: (m) => `Άγνωστος τύπος συστατικού «${m[1]}».`,
  },
  {
    pattern: /^Adding this ingredient would create a circular reference: (.+)\.$/,
    translate: (m) => `Η προσθήκη αυτού του συστατικού θα δημιουργούσε κυκλική αναφορά: ${m[1]}.`,
  },
  {
    pattern: /^Recipe (\d+) referenced in this recipe's graph no longer exists\.$/,
    translate: (m) =>
      `Η συνταγή ${m[1]} που αναφέρεται στο γράφημα αυτής της συνταγής δεν υπάρχει πλέον.`,
  },
  {
    pattern: /^Recipe (\d+) was not found\.$/,
    translate: (m) => `Η συνταγή ${m[1]} δεν βρέθηκε.`,
  },
  {
    pattern: /^Supplier (\d+) was not found\.$/,
    translate: (m) => `Ο προμηθευτής ${m[1]} δεν βρέθηκε.`,
  },
  {
    pattern: /^Password must be at least (\d+) characters long\.$/,
    translate: (m) => `Ο κωδικός πρέπει να έχει τουλάχιστον ${m[1]} χαρακτήρες.`,
  },
  // Partial translations: a known static prefix with an unpredictable lower-level error message
  // (raw OS/library text) preserved verbatim after the colon, since that tail can't be covered by
  // a lookup table.
  {
    pattern: /^Updater is not available: (.+)$/s,
    translate: (m) => `Το σύστημα ενημερώσεων δεν είναι διαθέσιμο: ${m[1]}`,
  },
  {
    pattern: /^Update check failed: (.+)$/s,
    translate: (m) => `Ο έλεγχος για ενημερώσεις απέτυχε: ${m[1]}`,
  },
  {
    pattern: /^Download failed: (.+)$/s,
    translate: (m) => `Η λήψη απέτυχε: ${m[1]}`,
  },
  {
    pattern: /^Install failed: (.+)$/s,
    translate: (m) => `Η εγκατάσταση απέτυχε: ${m[1]}`,
  },
  {
    pattern: /^Folder picker did not respond: (.+)$/s,
    translate: (m) => `Ο επιλογέας φακέλου δεν απάντησε: ${m[1]}`,
  },
  {
    pattern: /^File picker did not respond: (.+)$/s,
    translate: (m) => `Ο επιλογέας αρχείου δεν απάντησε: ${m[1]}`,
  },
  {
    pattern: /^Could not delete backup file: (.+)$/s,
    translate: (m) => `Δεν ήταν δυνατή η διαγραφή του αρχείου αντιγράφου ασφαλείας: ${m[1]}`,
  },
  {
    pattern: /^Database error: (.+)$/s,
    translate: (m) => `Σφάλμα βάσης δεδομένων: ${m[1]}`,
  },
  {
    pattern: /^This operation violates a data constraint: (.+)$/s,
    translate: (m) => `Αυτή η ενέργεια παραβιάζει έναν περιορισμό δεδομένων: ${m[1]}`,
  },
  // The costing engine's own typed errors (packages/core/src/costing/errors.ts) — thrown
  // client-side, not by the Rust backend, but translated the same way since they're an equally
  // fixed, enumerable set of message templates. See describeCostingError in lib/costingErrors.ts.
  {
    pattern: /^Circular dependency detected in recipe graph: (.+)$/,
    translate: (m) => `Εντοπίστηκε κυκλική εξάρτηση στο γράφημα συνταγών: ${m[1]}`,
  },
  {
    pattern: /^No purchase price could be resolved for raw material "(.+?)"(?: \((.+)\))?\.$/,
    // The parenthesized detail is itself one of a few fixed templates (see noPurchaseDetail in
    // packages/core/src/pricing/resolve.ts) — recursing through translateErrorMessage covers it
    // via the plain-string/pattern rules below instead of duplicating that logic here.
    translate: (m) =>
      m[2]
        ? `Δεν βρέθηκε τιμή αγοράς για την πρώτη ύλη "${m[1]}" (${translateErrorMessage(m[2], "el")}).`
        : `Δεν βρέθηκε τιμή αγοράς για την πρώτη ύλη "${m[1]}".`,
  },
  {
    pattern: /^no purchase on or before (.+)$/,
    translate: (m) => `καμία αγορά έως και ${m[1]}`,
  },
  {
    pattern: /^manual pricing strategy has no manual_price_micros configured$/,
    translate: () => "η χειροκίνητη στρατηγική τιμολόγησης δεν έχει ρυθμισμένη τιμή",
  },
  // `sourceDescription` values from packages/core/src/pricing/resolve.ts — not errors, just
  // display text describing which price was used, but translated the same way since it's an
  // equally fixed set of templates produced by a locale-unaware pure module.
  {
    pattern: /^latest purchase, (.+), (.+)$/,
    translate: (m) => `τελευταία αγορά, ${m[1]}, ${m[2]}`,
  },
  {
    pattern: /^latest purchase, (.+) \(no supplier recorded\)$/,
    translate: (m) => `τελευταία αγορά, ${m[1]} (χωρίς καταχωρημένο προμηθευτή)`,
  },
  {
    pattern: /^average of last (\d+) purchases?$/,
    translate: (m) => `μέσος όρος των τελευταίων ${m[1]} αγορών`,
  },
  {
    pattern:
      /^Sub-recipe id (\d+) is referenced as an ingredient but does not exist in the costing graph \(data integrity error\)\.$/,
    translate: (m) =>
      `Η υπο-συνταγή με id ${m[1]} αναφέρεται ως συστατικό αλλά δεν υπάρχει στο γράφημα κοστολόγησης (σφάλμα ακεραιότητας δεδομένων).`,
  },
  {
    pattern:
      /^Recipe "(.+)" is archived and cannot be used as a live ingredient in another recipe\.$/,
    translate: (m) =>
      `Η συνταγή "${m[1]}" είναι αρχειοθετημένη και δεν μπορεί να χρησιμοποιηθεί ως ενεργό συστατικό σε άλλη συνταγή.`,
  },
  {
    pattern:
      /^Target recipe id (\d+) does not exist in the costing graph \(data integrity error\)\.$/,
    translate: (m) =>
      `Η συνταγή-στόχος με id ${m[1]} δεν υπάρχει στο γράφημα κοστολόγησης (σφάλμα ακεραιότητας δεδομένων).`,
  },
  {
    pattern: /^Recipe nesting exceeds the maximum allowed depth of (\d+)\.$/,
    translate: (m) => `Η εμφώλευση συνταγών υπερβαίνει το μέγιστο επιτρεπόμενο βάθος των ${m[1]}.`,
  },
  {
    pattern:
      /^Recipe "(.+)" has an invalid yield quantity of (.+); yield must be greater than 0\.$/,
    translate: (m) =>
      `Η συνταγή "${m[1]}" έχει μη έγκυρη ποσότητα απόδοσης ${m[2]}· η απόδοση πρέπει να είναι μεγαλύτερη από 0.`,
  },
  {
    pattern:
      /^Cannot convert unit "(.+)" \((.+)\) to unit "(.+)" \((.+)\): units of different kinds are never auto-converted\.$/,
    translate: (m) =>
      `Δεν είναι δυνατή η μετατροπή της μονάδας "${m[1]}" (${m[2]}) στη μονάδα "${m[3]}" (${m[4]}): μονάδες διαφορετικού τύπου δεν μετατρέπονται ποτέ αυτόματα.`,
  },
  {
    pattern: /^Unknown unit code "(.+)": not present in the costing graph's unit list\.$/,
    translate: (m) =>
      `Άγνωστος κωδικός μονάδας "${m[1]}": δεν υπάρχει στη λίστα μονάδων του γραφήματος κοστολόγησης.`,
  },
];

/** Translates a raw `AppError.message` string for display. English messages pass through as-is. */
export function translateErrorMessage(message: string, locale: Locale): string {
  if (locale === "en") return message;

  const exact = EXACT_TRANSLATIONS[message];
  if (exact) return exact;

  for (const rule of PATTERN_RULES) {
    const match = message.match(rule.pattern);
    if (match) return rule.translate(match);
  }

  return message;
}
