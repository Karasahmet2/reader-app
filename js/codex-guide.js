// codex-guide.js — the Codex file format, as a prompt you can give to an AI agent.
// Shown in the app under Codex → ⋯ → Codex format guide (with a Copy button).

export const CODEX_PROMPT = `You are helping me set up "Codex" files for my personal e-book reader app. I read web novels and books
in this app. For each series, the app can import a Codex file that defines an EMPTY, well-organised
wiki structure for that series: the "rooms" (kinds of things in the story) and the "walls" (the fields
each room has and how rooms connect to each other). I will fill in the actual entries myself while
I read. You have the chapters of the series. Your job is to design the structure, NOT to fill it.

## The most important rules

1. NO ENTRIES. Do not list any characters, places, organisations, techniques, items or events from
   the story. The file contains only types and fields. I fill everything myself.
2. NO SPOILERS. Nothing you write (type names, field labels, hints, descriptions) may reveal plot
   facts, names, twists, relationships or anything that happens in the story. Use only generic wording.
   Bad:  "hint": "e.g. Winston, Julia, O'Brien"     Good: "hint": "People who appear in the story"
   Bad:  "labelHint": "e.g. secret brother"          Good: "labelHint": "e.g. brother, master, rival"
   Bad:  a type called "Brotherhood traitors"         Good: a type called "Organization"
3. Base the structure on what this story is actually built from. Read the chapters to understand the
   genre and what kinds of things keep coming back (e.g. sects and martial techniques in a Murim novel;
   ministries and concepts in a dystopia; spells and kingdoms in a fantasy; ranks/realms in a
   cultivation novel). Only create types that appear repeatedly and that a reader would want to look up.
4. Output must be a single valid JSON file, UTF-8, with no comments and no trailing commas.

## File name and the series name

- File name: exactly the series name + ".codex.json", e.g. "Absolute Regression.codex.json", "1984.codex.json".
- The "series" value must be EXACTLY the series name as written in the first line of the chapter files,
  which looks like:  Novel: Absolute Regression
  Copy it character for character (same spelling, capitals, spaces, punctuation).

## Format (version 1)

{
  "format": "reader-codex",
  "version": 1,
  "series": "Absolute Regression",
  "description": "Short, spoiler-free description of how this Codex is organised (optional).",
  "types": [
    {
      "id": "character",
      "name": "Character",
      "plural": "Characters",
      "color": "purple",
      "icon": "person",
      "hint": "People who appear in the story",
      "fields": [
        { "id": "title",     "label": "Title",     "kind": "text",     "hint": "e.g. a rank or nickname" },
        { "id": "faction",   "label": "Faction",   "kind": "link", "to": ["faction"] },
        { "id": "skills",    "label": "Skills",    "kind": "link", "to": ["skill"], "multiple": true },
        { "id": "relations", "label": "Relations", "kind": "link", "to": ["character"], "multiple": true,
          "withLabel": true, "labelHint": "e.g. brother, master, rival" },
        { "id": "appearance","label": "Appearance","kind": "longtext" }
      ]
    }
  ]
}

### Top level
- "format": always "reader-codex"
- "version": always 1
- "series": the exact series name (see above)
- "description": optional, one or two spoiler-free sentences
- "types": the list of rooms, 3 to 9 of them, in the order they should appear (most important first)

### Each type (room)
- "id": unique, lowercase letters, digits and hyphens only, singular (e.g. "character", "martial-skill").
  Never change an id later; the app uses it to keep my entries when the structure is updated.
- "name": singular display name, Title Case, max 20 characters (e.g. "Martial Skill")
- "plural": plural display name (e.g. "Martial Skills")
- "color": one of exactly these 12: red, orange, yellow, green, teal, sky, blue, purple, magenta, pink,
  brown, silver. Give every type a DIFFERENT color.
- "icon": one of exactly these: person, people, place, building, flag, crown, sword, spark, gem,
  scroll, book, beast, leaf, star, calendar, bulb, mask, ship
- "hint": optional, a short generic description of what goes in this room (shown when it is empty)
- "fields": 0 to 8 fields (see below)

Do NOT add fields for these. Every entry gets them automatically:
name, other names / aliases, "known from chapter", and a free "About" notes box.

### Each field (wall)
- "id": unique within its type, camelCase letters only (e.g. "worksAt", "realm", "masterOf")
- "label": short display label, max 20 characters, written so it reads well before a value:
  "Works at", "Leader", "Located in", "Realm", "Weapon"
- "kind": one of
    "text"     – a short value (a title, a rank, an age, a role)
    "longtext" – a paragraph (appearance, personality, abilities explained)
    "link"     – a connection to other entries
- "hint": optional short generic example of what to write ("e.g. a rank or nickname")
For "link" fields only:
- "to": array of one or more type ids that this link may point to; each must be a type id defined in
  this same file (e.g. ["place"] or ["character", "beast"])
- "multiple": true if it can point to several entries (skills, members, relations); false or omitted
  for exactly one (leader, located in)
- "withLabel": true if each connection needs its own word describing it (family/relations, "role in
  event"); add "labelHint" with generic examples

## Design guidelines

- Prefer a "link" over "text" whenever the value is itself something worth its own entry.
  ("Faction" → link to faction; "Hair colour" → text)
- Connect the rooms in both useful directions only once: e.g. Character → Faction is enough; do not also
  add Faction → Members (the app shows reverse connections automatically as "Linked from").
- Relations between people: one "relations" field on the person type, with "withLabel": true.
- Things that change while reading (rank, realm, title, allegiance) are fine as normal fields; the app
  keeps a history per chapter.
- Keep it small and clear. A good Codex is usually 4–7 types with 2–6 fields each.
- Use the vocabulary the story itself uses for its categories (e.g. "Sect" instead of "Organization"
  in a Murim novel; "Realm" in a cultivation novel) — but never names of specific things.

## Before you answer, check
- [ ] Valid JSON (no comments, no trailing commas), "format" and "version" correct
- [ ] "series" matches the "Novel:" line exactly
- [ ] 3–9 types, ids unique, lowercase, hyphens only; every type has a different allowed color and an allowed icon
- [ ] Every link's "to" only contains type ids defined in the file
- [ ] No entries, no names from the story, no spoilers anywhere
- [ ] No fields for name, aliases, known-from chapter or about

Answer with: (1) the JSON file content in one code block, named as described, and (2) a 3–5 line,
spoiler-free explanation of the rooms you chose and why. If I give you several series, make one file
per series.`;
