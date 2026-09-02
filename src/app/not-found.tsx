import Link from "next/link";
import { IconArrowLeft, IconMapOff } from "@tabler/icons-react";

import { BrandLogo } from "@/components/BrandLogo";

export default function NotFound() {
    return (
     <main className="min-h-screen bg-white pb-9 text-main md:pb-12 xl:pb-14">
          <header className="mb-7 flex justify-center">
                    <BrandLogo size="small" />
                </header>
          <div className="mx-auto w-full max-w-[375px] px-4 md:max-w-[768px] md:px-5 xl:max-w-[800px]">

                <section className="rounded-[24px] border border-line bg-white px-6 py-10 text-center shadow-[0_24px_70px_rgba(80,61,43,0.08)] md:px-12 md:py-14">
                    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#eef4f8] text-[#5a87b1]">
                        <IconMapOff aria-hidden="true" size={30} stroke={1.7} />
                    </div>

                    <p className="mb-2 text-[14px] font-semibold tracking-[0.28em] text-[#5a87b1]">
                        404
                    </p>
                    <h1 className="text-[24px] font-semibold tracking-wide md:text-[30px]">
                      本頁面不存在喔!
                    </h1>
                    <p className="mx-auto mt-4 max-w-[390px] text-[14px] leading-7 text-muted md:text-[16px]">
                        網址不存在、已經移動，或連結已失效。
                        <br />
                        請返回首頁，再重新尋找需要的內容。
                    </p>

                    <Link
                        className="mx-auto mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#5a87b1] px-7 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#4b769c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5a87b1]"
                        href="/"
                    >
                        <IconArrowLeft aria-hidden="true" size={18} stroke={2} />
                        返回首頁
                    </Link>
                </section>

                <p className="mt-6 text-center text-[12px] tracking-wide text-muted">
                    Archive · 好物值得被好好收藏
                </p>
            </div>
        </main>
    );
}
