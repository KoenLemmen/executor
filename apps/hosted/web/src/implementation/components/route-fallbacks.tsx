import { Empty } from "@executor-js/ui/components/empty";
import { Link } from "@tanstack/react-router";

/** Common missing-page UI; the host's router determines when to render it. */
export function PageNotFound() {
  return (
    <section className="page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <Empty className="empty-state min-h-77.5 flex flex-col justify-center items-center text-center p-[32px] text-muted-foreground border border-border rounded-[8px] [&_h2]:text-[14px] [&_h2]:text-foreground [&_h2]:font-medium [&_h2]:[margin:15px_0_5px] [&_p]:text-[12px] [&_p]:max-w-85 [&_a]:underline [&_a]:underline-offset-[3px] max-[740px]:min-h-62.5 max-[740px]:py-[24px] max-[740px]:px-[18px] max-[740px]:[&_a]:inline-flex max-[740px]:[&_a]:items-center max-[740px]:[&_a]:min-h-11">
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          Page not found
        </h1>
        <Link to="/">Choose organization</Link>
      </Empty>
    </section>
  );
}

/** A page failure can recover by loading the app inventory. */
export function PageError() {
  return (
    <section className="page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <Empty
        className="empty-state min-h-77.5 flex flex-col justify-center items-center text-center p-[32px] text-muted-foreground border border-border rounded-[8px] [&_h2]:text-[14px] [&_h2]:text-foreground [&_h2]:font-medium [&_h2]:[margin:15px_0_5px] [&_p]:text-[12px] [&_p]:max-w-85 [&_a]:underline [&_a]:underline-offset-[3px] max-[740px]:min-h-62.5 max-[740px]:py-[24px] max-[740px]:px-[18px] max-[740px]:[&_a]:inline-flex max-[740px]:[&_a]:items-center max-[740px]:[&_a]:min-h-11"
        role="alert"
      >
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          This page couldn’t load
        </h1>
        <a href="/">Choose organization</a>
      </Empty>
    </section>
  );
}
