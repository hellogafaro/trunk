// FILE: bootstrap.ts
// Purpose: Completes synchronous renderer storage migration before any app store can hydrate.

import "./storageOriginMigration";

import { bootstrapSignedOutScreen } from "./authSignedOut";
import { bootstrapAuthSession } from "./authSessionBootstrap";
import { bootstrapPairingSession } from "./pairingBootstrap";

if (!bootstrapSignedOutScreen()) {
  void bootstrapPairingSession().then((result) => {
    if (result === "not-pairing") {
      return bootstrapAuthSession().then((authResult) => {
        if (authResult !== "pairing-required") {
          return import("./main");
        }
      });
    }
  });
}
