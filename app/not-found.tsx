export default function NotFound() {
  return (
    <main className="flex min-h-[80dvh] flex-col items-center justify-center px-5 py-10 text-center">
      <img
        src="/001/404.svg"
        alt="404 — page not found"
        className="h-auto w-full max-w-[640px]"
      />
      <h1 className="mt-6 text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-[#2b3445] sm:text-[26px]">
        ไม่พบหน้าที่คุณต้องการ
      </h1>
      <p className="mt-2.5 max-w-[360px] text-[14px] leading-relaxed text-[#647088] sm:text-[15px]">
        ลิงก์นี้อาจถูกย้าย ลบไปแล้ว หรือเปิดโดยไม่มีข้อมูลเอกสาร
      </p>
    </main>
  );
}
