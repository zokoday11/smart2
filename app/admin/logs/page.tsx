"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { useAdminGuard } from "@/hooks/useAdminGuard";

interface UsageLogRow {
  id: string;
  userId: string;
  email?: string | null;
  type: string;
  createdAt?: Date | null;
  meta?: any;
}

function formatDateTime(date?: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function AdminLogsPage() {
  const { loading, isAdmin } = useAdminGuard();
  const [logs, setLogs] = useState<UsageLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  useEffect(() => {
    if (!isAdmin || loading) return;

    const fetchLogs = async () => {
      try {
        const q = query(
          collection(db, "usageLogs"),
          orderBy("createdAt", "desc"),
          limit(200)
        );
        const snap = await getDocs(q);
        const rows: UsageLogRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const createdAt =
            data.createdAt?.toDate?.() &&
            typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : null;

          return {
            id: d.id,
            userId: data.userId ?? "—",
            email: data.email ?? null,
            type: data.type ?? "—",
            createdAt,
            meta: data.meta ?? {},
          };
        });
        setLogs(rows);
      } catch (err) {
        console.error("Erreur chargement logs:", err);
      } finally {
        setLoadingLogs(false);
      }
    };

    fetchLogs();
  }, [loading, isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-xs text-[var(--muted)]">
          Chargement de l&apos;admin…
        </p>
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen px-4 sm:px-8 py-6 bg-[var(--bg)] text-[var(--ink)]">
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <h1 className="text-xl sm:text-2xl font-semibold">
            Logs d&apos;utilisation
          </h1>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1 max-w-xl">
            Historique des actions des utilisateurs (génération de CV, LM,
            etc.).
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="glass rounded-2xl p-4 overflow-x-auto"
        >
          {loadingLogs ? (
            <p className="text-[12px] text-[var(--muted)]">
              Chargement des logs…
            </p>
          ) : logs.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">
              Aucun log pour le moment.
            </p>
          ) : (
            <table className="w-full text-[11px] sm:text-xs">
              <thead className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                <tr className="text-left border-b border-[var(--border)]">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">User</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Meta</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-[var(--border)]/60 last:border-none align-top"
                  >
                    <td className="py-2 pr-2">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-col">
                        <span className="font-medium text-[11px]">
                          {log.email || "—"}
                        </span>
                        <span className="text-[10px] text-[var(--muted)]">
                          UID: {log.userId?.slice(0, 8) || "—"}…
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <span className="inline-flex px-2 py-[2px] rounded-full border border-[var(--border)] text-[10px]">
                        {log.type}
                      </span>
                    </td>
                    <td className="py-2 pr-2 max-w-xs">
                      <pre className="text-[10px] whitespace-pre-wrap break-words text-[var(--muted)]">
                        {JSON.stringify(log.meta ?? {}, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </motion.div>
      </div>
    </div>
  );
}
