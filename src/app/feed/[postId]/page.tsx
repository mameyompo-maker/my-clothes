"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * 2択の詳細は /vote/[postId] に移した(/feed は公開タイムラインになったため)。
 * 友達に配ったリンクが死なないよう、ここは転送だけ残している。
 */
export default function LegacyVoteRedirect() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/vote/${postId}`);
  }, [postId, router]);

  return <p className="mt-10 text-center text-sm text-muted-foreground">移動しています…</p>;
}
