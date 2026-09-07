import type { UseFormRegister } from "react-hook-form";
import { POSTER_FORMATS, POSTER_SIZES, POSTER_CRAFTS } from "@/constants";
import type { NewProductForm } from "./new-product-schema";
import { ProductFormField as Field } from "./ProductFormField";

export function PosterSpecFields({
  register,
}: {
  register: UseFormRegister<NewProductForm>;
}) {
  return (
    <>
      <Field label="版本 / 影廳">
        <select {...register("format")}>
          {POSTER_FORMATS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </Field>
      <Field label="尺寸">
        <select {...register("size")}>
          {POSTER_SIZES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </Field>
      <Field label="工藝（可複選）" wide>
        <div className="chips">
          {POSTER_CRAFTS.map((x) => (
            <label key={x}>
              <input type="checkbox" value={x} {...register("crafts")} />
              {x}
            </label>
          ))}
        </div>
      </Field>
      <Field label="辨識特徵" wide>
        <textarea
          {...register("feature")}
          placeholder="例：左下角有 IMAX Logo、標題燙金…"
        />
      </Field>
    </>
  );
}
