// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// Helper: check Authorization header Bearer <ID_TOKEN> and required role
async function checkAuth(req, res, requiredRole = "admin") {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  if (!token) throw new Error("Missing auth token");

  const decoded = await admin.auth().verifyIdToken(token);
  const userDocSnap = await db.collection("users").doc(decoded.uid).get();
  const role = userDocSnap.exists ? userDocSnap.data().role : "user";

  // GrandWizard can do everything
  if (role === "GrandWizard") return { uid: decoded.uid, role };

  // If requiredRole is GrandWizard only, block others
  if (requiredRole === "GrandWizard") {
    throw new Error("Not authorized: GrandWizard required");
  }

  // Admin or exact match requiredRole
  if (role === requiredRole || role === "admin") {
    return { uid: decoded.uid, role };
  }

  throw new Error("Not authorized");
}

// Utility: write audit log
async function moderationLog(action, targetUid, byUid, meta = {}) {
  try {
    await db.collection("moderationLogs").add({
      action,
      targetUid,
      by: byUid || null,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      meta
    });
  } catch (e) {
    console.error("Failed to write moderation log", e);
  }
}

// Helper: fetch target user's role
async function getTargetRole(targetUid) {
  const snap = await db.collection("users").doc(targetUid).get();
  return snap.exists ? snap.data().role : null;
}

/* ---------------------------
   Toggle permanent ban (admin)
   body: { targetUid: string, banned: boolean }
   --------------------------- */
exports.adminToggleBan = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const caller = await checkAuth(req, res, "admin");
      const { targetUid, banned } = req.body;
      if (!targetUid) throw new Error("Missing targetUid");

      const targetRole = await getTargetRole(targetUid);
      // GrandWizard immunity: only GrandWizard can ban another GrandWizard
      if (targetRole === 'GrandWizard' && caller.role !== 'GrandWizard') {
        throw new Error("Cannot ban a GrandWizard");
      }

      const updateObj = {
        banned: !!banned,
        // if unbanning, clear bannedUntil
        bannedUntil: banned ? null : null,
        banType: !!banned ? "permanent" : null
      };

      // If banned === false (unban) we want to clear bannedUntil; if banned === true we keep existing bannedUntil null (permanent)
      if (banned === true) {
        updateObj.banned = true;
        updateObj.bannedUntil = null;
        updateObj.banType = "permanent";
      } else {
        updateObj.banned = false;
        updateObj.bannedUntil = null;
        updateObj.banType = null;
      }

      await db.collection("users").doc(targetUid).update(updateObj);
      await moderationLog("toggleBan", targetUid, caller.uid, { banned: !!banned });

      res.json({ success: true, banned: !!banned });
    } catch (err) {
      console.error("adminToggleBan error:", err);
      res.status(403).json({ error: err.message || String(err) });
    }
  });
});

/* ---------------------------
   Temp ban (admin)
   body: { targetUid: string, durationMs: number }
   Writes: banned: true, bannedUntil: Timestamp, banType: "temp"
   --------------------------- */
exports.adminTempBan = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const caller = await checkAuth(req, res, "admin");
      const { targetUid, durationMs } = req.body;
      if (!targetUid || !durationMs) throw new Error("Missing targetUid or durationMs");

      const targetRole = await getTargetRole(targetUid);
      if (targetRole === 'GrandWizard' && caller.role !== 'GrandWizard') {
        throw new Error("Cannot temp-ban a GrandWizard");
      }

      const untilMillis = Date.now() + Number(durationMs);
      const untilTs = admin.firestore.Timestamp.fromMillis(untilMillis);

      await db.collection("users").doc(targetUid).update({
        banned: true,
        bannedUntil: untilTs,
        banType: "temp"
      });

      await moderationLog("tempBan", targetUid, caller.uid, { durationMs: Number(durationMs), until: untilTs.toDate() });

      res.json({ success: true, until: untilTs.toDate() });
    } catch (err) {
      console.error("adminTempBan error:", err);
      res.status(403).json({ error: err.message || String(err) });
    }
  });
});

/* ---------------------------
   Shadowban (admin)
   body: { targetUid: string, shadowBanned: boolean }
   --------------------------- */
exports.adminShadowBan = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const caller = await checkAuth(req, res, "admin");
      const { targetUid, shadowBanned } = req.body;
      if (!targetUid) throw new Error("Missing targetUid");

      const targetRole = await getTargetRole(targetUid);
      if (targetRole === 'GrandWizard' && caller.role !== 'GrandWizard') {
        throw new Error("Cannot shadow-ban a GrandWizard");
      }

      await db.collection("users").doc(targetUid).update({ shadowBanned: !!shadowBanned });
      await moderationLog("shadowBan", targetUid, caller.uid, { shadowBanned: !!shadowBanned });

      res.json({ success: true, shadowBanned: !!shadowBanned });
    } catch (err) {
      console.error("adminShadowBan error:", err);
      res.status(403).json({ error: err.message || String(err) });
    }
  });
});

/* ---------------------------
   Revoke tokens (GrandWizard only)
   body: { targetUid: string }
   --------------------------- */
exports.adminRevokeTokens = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const caller = await checkAuth(req, res, "GrandWizard");
      const { targetUid } = req.body;
      if (!targetUid) throw new Error("Missing targetUid");

      await admin.auth().revokeRefreshTokens(targetUid);
      await moderationLog("revokeTokens", targetUid, caller.uid);

      res.json({ success: true });
    } catch (err) {
      console.error("adminRevokeTokens error:", err);
      res.status(403).json({ error: err.message || String(err) });
    }
  });
});

/* ---------------------------
   Delete all messages for a user (admin)
   body: { targetUid: string }
   --------------------------- */
exports.adminDeleteMessagesForUser = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const caller = await checkAuth(req, res, "admin");
      const { targetUid } = req.body;
      if (!targetUid) throw new Error("Missing targetUid");

      // allow deleting messages even for GrandWizard (you might want to block, but leaving as admin privilege)
      const snap = await db.collection("messages").where("uid", "==", targetUid).get();
      const batch = db.batch();
      snap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      await moderationLog("deleteMessages", targetUid, caller.uid, { deletedCount: snap.size });

      res.json({ success: true, deleted: snap.size });
    } catch (err) {
      console.error("adminDeleteMessagesForUser error:", err);
      res.status(403).json({ error: err.message || String(err) });
    }
  });
});

/* ---------------------------
   Delete Auth user + firestore doc (GrandWizard only)
   body: { targetUid: string }
   --------------------------- */
exports.adminDeleteAuthUser = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const caller = await checkAuth(req, res, "GrandWizard");
      const { targetUid } = req.body;
      if (!targetUid) throw new Error("Missing targetUid");

      // Delete auth user (if exists)
      await admin.auth().deleteUser(targetUid).catch(err => {
        console.warn("deleteUser warning:", err.message || err);
      });

      // Delete Firestore user doc
      await db.collection("users").doc(targetUid).delete().catch(e => console.warn("delete user doc warning:", e));

      // Optionally delete messages
      const snap = await db.collection("messages").where("uid", "==", targetUid).get();
      const batch = db.batch();
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      await moderationLog("deleteAuthUser", targetUid, caller.uid, { removedMessages: snap.size });

      res.json({ success: true });
    } catch (err) {
      console.error("adminDeleteAuthUser error:", err);
      res.status(403).json({ error: err.message || String(err) });
    }
  });
});
