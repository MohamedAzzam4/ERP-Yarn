import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BidiValue } from "@/components/shared/BidiValue";

describe("RTL root and LTR isolation", () => {
  it("the html root has lang=ar and dir=rtl", () => {
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("BidiValue renders a bdi element with dir=ltr", () => {
    const { container } = render(<BidiValue>SAL-2026-0007</BidiValue>);
    const bdi = container.querySelector("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("ltr");
    expect(bdi?.textContent).toBe("SAL-2026-0007");
  });

  it("BidiValue applies unicode-bidi-isolate so embedded codes do not flip surrounding Arabic", () => {
    const { container } = render(
      <p dir="rtl">
        رقم البيع <BidiValue>SAL-2026-0007</BidiValue> صادر للعميل.
      </p>,
    );
    const bdi = container.querySelector("bdi");
    expect(bdi?.className).toContain("unicode-bidi-isolate");
  });

  it("BidiValue numeric variant uses tabular-nums", () => {
    const { container } = render(<BidiValue numeric>{1234567}</BidiValue>);
    const bdi = container.querySelector("bdi");
    expect(bdi?.className).toContain("tabular-nums");
  });
});
