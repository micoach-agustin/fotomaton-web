import { assetPath } from "../config";

export type PropPlace = {
  src: string;
  /** Punto del PNG (0–1) que se apoya en la cara. */
  anchorX: number;
  anchorY: number;
  /** Dónde cae ese punto dentro del área de accesorios (0–1). */
  faceX: number;
  faceY: number;
  /** Ancho del PNG respecto al ancho del área de accesorios. */
  width: number;
};

export type BodaProp = PropPlace & {
  id: string;
  label: string;
  /** Id estable del conteo, por ejemplo accesorio:velo. */
  uso: string;
  /** Otra pieza del mismo accesorio. También se compone en la foto. */
  extra?: PropPlace[];
};

/**
 * Ancla fija: ojos en el tercio alto. En horizontal se centra el área vertical.
 * La persona se acerca o se aleja para encajar. Sin detector.
 * El marco floral sigue encima y tapa solo el borde.
 * Los carteles son accesorios: se dibujan encima de la persona.
 */
const LA_NOVIA: PropPlace = {
  src: assetPath("templates/photo_prop_sign_la_novia_01.png"),
  anchorX: 0.5,
  anchorY: 0.38,
  faceX: 0.22,
  faceY: 0.74,
  width: 0.36,
};

const EL_NOVIO: PropPlace = {
  src: assetPath("templates/photo_prop_sign_el_novio_01.png"),
  anchorX: 0.5,
  anchorY: 0.38,
  faceX: 0.78,
  faceY: 0.74,
  width: 0.36,
};

export const BODA_PROPS: BodaProp[] = [
  {
    id: "lentes",
    uso: "accesorio:lentes",
    src: assetPath("templates/photo_prop_glasses_eg_front_02.png"),
    label: "Lentes",
    anchorX: 0.5,
    anchorY: 0.49,
    faceX: 0.5,
    faceY: 0.36,
    width: 0.78,
  },
  {
    id: "velo",
    uso: "accesorio:velo",
    src: assetPath("templates/photo_prop_bridal_veil_face_open_02.png"),
    label: "Velo",
    anchorX: 0.5,
    anchorY: 0.22,
    faceX: 0.5,
    faceY: 0.185,
    width: 1,
  },
  {
    id: "sombrero",
    uso: "accesorio:sombrero",
    src: assetPath("templates/photo_prop_top_hat_01.png"),
    label: "Sombrero",
    anchorX: 0.51,
    anchorY: 0.7,
    faceX: 0.5,
    faceY: 0.26,
    width: 0.84,
  },
  {
    id: "corona",
    uso: "accesorio:corona",
    src: assetPath("templates/photo_prop_heart_crown_01.png"),
    label: "Corona",
    anchorX: 0.5,
    anchorY: 0.64,
    faceX: 0.5,
    faceY: 0.24,
    width: 0.69,
  },
  {
    id: "bigote",
    uso: "accesorio:bigote",
    src: assetPath("templates/photo_prop_party_moustache_01.png"),
    label: "Bigote",
    anchorX: 0.5,
    anchorY: 0.59,
    faceX: 0.5,
    faceY: 0.5,
    width: 0.5,
  },
  {
    id: "mono",
    uso: "accesorio:mono",
    src: assetPath("templates/photo_prop_gala_bowtie_01.png"),
    label: "Moño",
    anchorX: 0.5,
    anchorY: 0.5,
    faceX: 0.5,
    faceY: 0.68,
    width: 0.4,
  },
  {
    id: "diadema",
    uso: "accesorio:diadema",
    src: assetPath("templates/photo_prop_team_novios_headband_arch_03.png"),
    label: "Diadema",
    anchorX: 0.5,
    anchorY: 0.34,
    faceX: 0.5,
    faceY: 0.2,
    width: 0.88,
  },
  {
    id: "lazo",
    uso: "accesorio:mono-pelo",
    src: assetPath("templates/photo_prop_hair_bow_coral_01.png"),
    label: "Moño de pelo",
    anchorX: 0.5,
    anchorY: 0.34,
    faceX: 0.5,
    faceY: 0.16,
    width: 0.56,
  },
  {
    id: "corbata",
    uso: "accesorio:corbata",
    src: assetPath("templates/photo_prop_groom_necktie_01.png"),
    label: "Corbata",
    anchorX: 0.5,
    anchorY: 0.2,
    faceX: 0.5,
    faceY: 0.78,
    width: 1.15,
  },
  {
    id: "el-novio",
    uso: "accesorio:el-novio",
    label: "El novio",
    ...EL_NOVIO,
  },
  {
    id: "la-novia",
    uso: "accesorio:la-novia",
    label: "La novia",
    ...LA_NOVIA,
  },
  {
    id: "los-dos",
    uso: "accesorio:la-novia-y-el-novio",
    label: "Los dos",
    ...LA_NOVIA,
    extra: [EL_NOVIO],
  },
];

export function propSources() {
  const sources = BODA_PROPS.flatMap((prop) => [prop.src, ...(prop.extra || []).map((piece) => piece.src)]);
  return [...new Set(sources)];
}

export function propById(id: string) {
  return BODA_PROPS.find((prop) => prop.id === id) || null;
}

export function propPieces(prop: BodaProp): PropPlace[] {
  return [prop, ...(prop.extra || [])];
}

export function propBox(prop: PropPlace, frameWidth: number, frameHeight: number, sourceWidth = 700, sourceHeight = 500) {
  // En horizontal, conservar la escala de una cara en vez de estirar el
  // accesorio a todo el ancho. Visor y exportación usan la misma geometría.
  const areaWidth = frameWidth > frameHeight ? frameHeight * (9 / 16) : frameWidth;
  const left = (frameWidth - areaWidth) / 2;
  const width = areaWidth * prop.width;
  const height = sourceWidth > 0 ? width * (sourceHeight / sourceWidth) : width;
  return {
    x: left + areaWidth * prop.faceX - width * prop.anchorX,
    y: frameHeight * prop.faceY - height * prop.anchorY,
    width,
    height,
  };
}
