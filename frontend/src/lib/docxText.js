// =============================================================================
// HPA -- Parse a TEXT-BASED test booklet (.docx) into passages + questions.
// =============================================================================
// Word .docx exports break each visual line into a separate paragraph, so the
// extracted text looks like:
//
//   1. What is the correct way to hyphenate the underlined phrase?
//   Keersten's family was thrilled to win an all inclusive trip ...
//   A.
//   an all inclusive-trip
//   B.
//   an all-inclusive-trip
//   ...
//   D.
//   NO CHANGE
//   Dear Editor:                          <- start of next passage
//   (1) Tuesday was a sad day ...
//   10. Which sentence should ...         <- next question
//
// Strategy: an explicit state machine.
//   STATE_STEM      = collecting stem lines until we see an A/B/C/D marker
//   STATE_CHOICE_X  = the next non-marker line is the text for choice X
//                     (or already on the marker line itself)
//   STATE_PASSAGE   = after D's text, anything until next "N." is a passage
// =============================================================================

import { extractDocxText } from "./docxImages";

function matchQuestionStart(line) {
  const m = line.match(/^\s*(\d{1,3})\.\s*(.*)$/);
  if (!m) return null;
  return { qn: parseInt(m[1], 10), rest: m[2] };
}

function matchChoiceMarker(line) {
  const m = line.match(/^\s*([ABCD])[\.\)]\s*(.*)$/);
  if (!m) return null;
  return { letter: m[1], rest: m[2] };
}

const ORDER = ["A", "B", "C", "D"];

export async function parseTextBookletDocx(file) {
  const text = await extractDocxText(file);
  if (!text) throw new Error("Couldn't read the .docx — file may be empty.");

  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const passages = [];
  const questions = [];
  let passageCounter = 0;
  let lastAttachedPassage = null; // for shared-passage detection

  // Passage builder (between questions, or after D and before next "N.")
  let pendingTitle = null;
  let pendingBody = [];

  // Question builder
  let currentQ = null;
  let stemLines = [];
  let choiceSlot = null; // which letter we're filling (A|B|C|D|null)

  let firstQuestionSeen = false;

  function flushPassage() {
    if (pendingBody.length === 0 && !pendingTitle) return null;
    passageCounter += 1;
    // When the passage is only one paragraph (no separate title + body),
    // promote the single line to the body so the student still sees the
    // passage content. (Word tables / inline passages produce this.)
    let title = pendingTitle;
    let body;
    if (pendingBody.length === 0 && pendingTitle) {
      body = pendingTitle;
      title = null;
    } else {
      body = pendingBody.join("\n\n");
    }
    passages.push({
      ordinal: passageCounter,
      title: title || null,
      body,
    });
    pendingTitle = null;
    pendingBody = [];
    return passageCounter;
  }

  function commitQuestion(attach) {
    if (!currentQ) return;
    currentQ.stem = stemLines.join(" ").replace(/\s+/g, " ").trim();
    currentQ.passage_ordinal = attach || null;
    questions.push(currentQ);
    currentQ = null;
    stemLines = [];
    choiceSlot = null;
  }

  function startQuestion(qn, restOfLine) {
    let attach;
    if (pendingBody.length > 0 || pendingTitle) {
      attach = flushPassage();
      lastAttachedPassage = attach;
    } else {
      attach = lastAttachedPassage;
    }
    currentQ = {
      qn,
      stem: "",
      choices: { A: "", B: "", C: "", D: "" },
      passage_ordinal: attach,
    };
    stemLines = restOfLine ? [restOfLine] : [];
    choiceSlot = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New question always wins, regardless of state.
    const qStart = matchQuestionStart(line);
    if (qStart) {
      if (!firstQuestionSeen) {
        // Discard the test header / instructions block.
        pendingTitle = null;
        pendingBody = [];
        firstQuestionSeen = true;
      } else {
        commitQuestion(lastAttachedPassage);
      }
      startQuestion(qStart.qn, qStart.rest);
      continue;
    }

    if (!firstQuestionSeen) continue; // still in header

    if (currentQ) {
      // Are we still filling answer choices?
      const allChoicesDone =
        choiceSlot === "D" &&
        currentQ.choices.D &&
        currentQ.choices.D.length > 0;

      if (!allChoicesDone) {
        const choice = matchChoiceMarker(line);
        if (choice) {
          choiceSlot = choice.letter;
          if (choice.rest) {
            // Marker had inline text -- record it. (Many docs do this for
            // single-word answers, e.g. "A. amusing.")
            currentQ.choices[choice.letter] = choice.rest;
          }
          continue;
        }
        if (choiceSlot) {
          // The marker was on its own line; this is the text of that choice.
          // Append (in case it spans more than one paragraph, though rare).
          currentQ.choices[choiceSlot] =
            (currentQ.choices[choiceSlot]
              ? currentQ.choices[choiceSlot] + " "
              : "") + line;
          continue;
        }
        // No choice yet → still collecting stem.
        stemLines.push(line);
        continue;
      }

      // All four choices captured -- this line is the next passage.
      // Fall through to passage-builder below.
    }

    // Between questions (or after this question's D) → passage builder.
    if (!pendingTitle && pendingBody.length === 0) {
      pendingTitle = line;
    } else {
      pendingBody.push(line);
    }
  }

  if (currentQ) commitQuestion(lastAttachedPassage);

  return { passages, questions };
}

export function validateParsedBooklet({ passages, questions }) {
  const warnings = [];
  if (questions.length === 0) {
    warnings.push("No questions were detected. Make sure your questions start with '1.', '2.', etc.");
  }
  const missingChoices = questions.filter(q =>
    !q.choices.A || !q.choices.B || !q.choices.C || !q.choices.D
  );
  if (missingChoices.length) {
    warnings.push(`${missingChoices.length} question(s) are missing one or more A/B/C/D answer choices.`);
  }
  const sorted = [...questions].sort((a, b) => a.qn - b.qn);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].qn !== i + 1) {
      warnings.push(`Question numbering looks off — expected ${i + 1}, found ${sorted[i].qn}.`);
      break;
    }
  }
  const usedPassageOrdinals = new Set(
    questions.map(q => q.passage_ordinal).filter(Boolean)
  );
  const orphans = passages.filter(p => !usedPassageOrdinals.has(p.ordinal));
  if (orphans.length) {
    warnings.push(`${orphans.length} passage(s) are not referenced by any question — they will still import.`);
  }
  return warnings;
}
