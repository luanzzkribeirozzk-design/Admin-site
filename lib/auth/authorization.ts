import { getAuth } from "firebase-admin/auth";
import { getFirebaseAdminApp, getAdminFirestore } from "@/lib/firebase/admin";

export async function requireAdmin(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Error("Não autenticado");
  const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(header.slice(7));
  const snapshot = await getAdminFirestore().collection("users").doc(decoded.uid).get();
  const user = snapshot.data();
  if (!snapshot.exists || user?.role !== "admin" || user?.status !== "active") {
    throw new Error("Acesso administrativo negado");
  }
  return decoded;
}
