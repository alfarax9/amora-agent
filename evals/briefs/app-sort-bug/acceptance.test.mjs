import { reactAcceptance } from "../../hidden/react-acceptance.mjs";

// Hidden acceptance test: the project builds, then hidden.test.tsx runs
// inside it. Neither AMORA nor the baseline sees either file.
reactAcceptance(import.meta.url);
