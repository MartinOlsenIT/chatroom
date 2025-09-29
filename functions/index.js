// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const corsLib = require("cors");
const cors = corsLib({ origin: true });

admin.initializeApp();
const db = admin.firestore();

function roleLevel(role){
  if (!role) return 0;
  if (role === "GrandWizard") return 3;
  if (role === "admin") return 2;
  if (role === "moderator") return 1;
  return 0;
}

async function getCallerUidFromReq(req){
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw { status: 401, message: "Missing Authorization Bearer token" };
  }
  const idToken = authHeader.split("Bearer ")[1];
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
}
async function getUserRole(uid){
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) return null;
  return snap.data().role || "user";
}

// delete docs in batches (limit 500)
async function deleteQueryBatch(q){
  const snapshot = await q.get();
  if (snapshot.empty) return 0;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}

// HTTP: delete all messages for a user (batched)
exports.adminDeleteMessagesForUser = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Use POST");
      const { targetUid } = req.body || {};
      if (!targetUid) return res.status(400).send("targetUid required");

      const callerUid = await getCallerUidFromReq(req);
      const callerRole = await getUserRole(callerUid);
      if (roleLevel(callerRole) < roleLevel("admin")) {
        return res.status(403).send("Requires admin privileges");
      }

      const batchSize = 500;
      let totalDeleted = 0;
      while (true) {
        const q = db.collection("messages").where("uid", "==", targetUid).limit(batchSize);
        const deleted = await deleteQueryBatch(q);
        if (deleted === 0) break;
        totalDeleted += deleted;
      }

      await db.collection("moderationLogs").add({
        action: "deleteMessages",
        targetUid,
        by: callerUid,
        deletedCount: totalDeleted,
        ts: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ ok: true, deleted: totalDeleted });
    } catch (err) {
      console.error("adminDeleteMessagesForUser err:", err);
      return res.status(err.status || 500).send(err.message || String(err));
    }
  });
});

// HTTP: revoke refresh tokens (force logout) - GrandWizard only
exports.adminRevokeTokens = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Use POST");
      const { targetUid } = req.body || {};
      if (!targetUid) return res.status(400).send("targetUid required");

      const callerUid = await getCallerUidFromReq(req);
      const callerRole = await getUserRole(callerUid);
      if (roleLevel(callerRole) < roleLevel("GrandWizard")) {
        return res.status(403).send("Requires GrandWizard privileges");
      }

      await admin.auth().revokeRefreshTokens(targetUid);
      await db.collection("moderationLogs").add({
        action: "revokeTokens",
        targetUid,
        by: callerUid,
        ts: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("adminRevokeTokens err:", err);
      return res.status(err.status || 500).send(err.message || String(err));
    }
  });
});

// HTTP: delete an Auth user (GrandWizard only) - remove messages, user doc, auth account
exports.adminDeleteAuthUser = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).send("Use POST");
      const { targetUid } = req.body || {};
      if (!targetUid) return res.status(400).send("targetUid required");

      const callerUid = await getCallerUidFromReq(req);
      const callerRole = await getUserRole(callerUid);
      if (roleLevel(callerRole) < roleLevel("GrandWizard")) {
        return res.status(403).send("Requires GrandWizard privileges");
      }

      // delete messages in batches
      let totalDeleted = 0;
      while (true) {
        const q = db.collection("messages").where("uid", "==", targetUid).limit(500);
        const deleted = await deleteQueryBatch(q);
        if (deleted === 0) break;
        totalDeleted += deleted;
      }

      // remove Firestore user doc (if exists)
      await db.doc(`users/${targetUid}`).delete().catch(()=>{});

      // delete auth user
      await admin.auth().deleteUser(targetUid);

      await db.collection("moderationLogs").add({
        action: "deleteAuthUser",
        targetUid,
        by: callerUid,
        deletedMessages: totalDeleted,
        ts: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ ok: true, deletedMessages: totalDeleted });
    } catch (err) {
      console.error("adminDeleteAuthUser err:", err);
      return res.status(err.status || 500).send(err.message || String(err));
    }
  });
});

// Firestore trigger: on new message -> enforce banned/shadow behaviors
exports.onMessageCreate = functions.firestore
  .document("messages/{messageId}")
  .onCreate(async (snap, ctx) => {
    try {
      const message = snap.data();
      const uid = message.uid;
      if (!uid) return null;

      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) return null;
      const user = userSnap.data();

      const now = admin.firestore.Timestamp.now();
      const bannedBool = !!user.banned;
      const bannedUntil = user.bannedUntil || null;
      if (bannedBool || (bannedUntil && bannedUntil.toMillis && bannedUntil.toMillis() > now.toMillis())) {
        // user is banned => delete message
        await snap.ref.delete();
        await db.collection("moderationLogs").add({
          action: "deletedMessage_from_banned_user",
          messageId: snap.id,
          uid,
          ts: admin.firestore.FieldValue.serverTimestamp()
        });
        return null;
      }

      // shadow ban => mark hidden so non-admins won't see
      if (user.shadowBanned) {
        await snap.ref.update({ hidden: true });
        await db.collection("moderationLogs").add({
          action: "shadowHideMessage",
          messageId: snap.id,
          uid,
          ts: admin.firestore.FieldValue.serverTimestamp()
        });
        return null;
      }

      // otherwise ensure not hidden
      if (snap.exists && snap.data().hidden) {
        await snap.ref.update({ hidden: false }).catch(()=>{});
      }
      return null;
    } catch (err) {
      console.error("onMessageCreate error:", err);
      return null;
    }
  });
