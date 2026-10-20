import { describe, expect, it } from "vitest";
import { parseCecModules, shortMake } from "./library";

// Three header rows as in SAM's "CEC Modules.csv", then modules (values abridged from the file's layout).
const HEAD = [
  "Name,Manufacturer,Technology,Bifacial,STC,PTC,A_c,Length,Width,N_s,I_sc_ref,V_oc_ref,I_mp_ref,V_mp_ref,alpha_sc,beta_oc,T_NOCT,a_ref,I_L_ref,I_o_ref,R_s,R_sh_ref,Adjust,gamma_pmp,BIPV,Version,Date",
  "Units,,,,,,m2,m,m,,A,V,A,V,A/K,V/K,C,V,A,A,Ohm,Ohm,%,%/K,,,",
  "[0],lib_manufacturer,cec_material,lib_is_bifacial,,,cec_area,lib_length,lib_width,cec_n_s,cec_i_sc_ref,cec_v_oc_ref,cec_i_mp_ref,cec_v_mp_ref,cec_alpha_sc,cec_beta_oc,cec_t_noct,cec_a_ref,cec_i_l_ref,cec_i_o_ref,cec_r_s,cec_r_sh_ref,cec_adjust,cec_gamma_pmp,,,",
];
const row = (name: string, make: string, stc: string, len: string, wid: string, voc = "41.1") =>
  `${name},${make},Mono-c-Si,0,${stc},409.2,2.09,${len},${wid},20,13.79,${voc},13.16,33.82,0.0069,-0.1251,45,1.5,13.8,1e-10,0.2,300,6.0,-0.39,N,2026.7.3,6/23/2026`;

describe("parseCecModules", () => {
  it("maps SAM columns to catalogue specs", () => {
    const csv = [...HEAD, row("Jinko Solar Co Ltd JKM445M-60HL4", "Jinko Solar Co Ltd", "445", "1.903", "1.134")].join("\n");
    const { products, version } = parseCecModules(csv);
    expect(version).toBe("2026.7.3");
    expect(products).toEqual([
      {
        category: "panel",
        make: "Jinko Solar",
        model: "JKM445M-60HL4",
        name: "Jinko Solar JKM445M-60HL4 445 W",
        specs: { watts_peak: 445, voc: 41.1, vmp: 33.82, isc: 13.79, imp: 13.16, temp_coeff_voc: -0.304, height_mm: 1903, width_mm: 1134 },
      },
    ]);
  });

  it("leaves out missing dimensions, skips duplicates and rows without key values", () => {
    const csv = [...HEAD, row("Acme Inc A1", "Acme Inc", "400", "", ""), row("Acme Inc A1", "Acme Inc", "400", "", ""), row("Acme Inc A2", "Acme Inc", "", "1.7", "1.1"), row("Acme Inc A3", "Acme Inc", "410", "1.1", "1.7", "")].join("\n");
    const { products, skipped } = parseCecModules(csv);
    expect(products).toHaveLength(1);
    expect(products[0]!.specs.width_mm).toBeUndefined();
    expect(skipped).toBe(3);
  });

  it("refuses a file that isn't the SAM library", () => {
    expect(() => parseCecModules("make,model\nA,B")).toThrow(/SAM CEC/);
  });
});

describe("shortMake", () => {
  it("drops company suffixes", () => {
    expect(shortMake("Jinko Solar Co., Ltd.")).toBe("Jinko Solar");
    expect(shortMake("LONGi Green Energy Technology Co Ltd")).toBe("LONGi Green Energy Technology");
    expect(shortMake("REC Solar Pte Ltd")).toBe("REC Solar");
    expect(shortMake("Ltd")).toBe("Ltd");
  });
});
