/**
 * Padrón de empleados: PIN del dispositivo -> nombre y departamento.
 *
 * El PIN es el campo 1 de cada marcación ATTLOG. El equipo solo envía el
 * número: los nombres viven en el software de gestión, nunca viajan en la trama.
 *
 * Ojo con el histórico: el dispositivo conserva marcaciones desde enero de 2025
 * con PINs de personal que ya no figura en el padrón actual. Esos aparecen como
 * "sin registrar", que no es un error del parser sino un dato real.
 *
 * En el endpoint definitivo esto no va en un archivo: sale de la tabla de
 * empleados de la base de datos. Aquí es una tabla fija porque el laboratorio
 * no tiene base de datos.
 */

export const EMPLEADOS = {
  3: { nombre: 'YURANIS', depto: 'Gestión De Ventas' },
  4: { nombre: 'RAUL DARIO', depto: 'Ingeniería y Diseño' },
  5: { nombre: 'MAYRA ALEJANDRA', depto: 'Talento Humano' },
  8: { nombre: 'WENDY CAROLINA', depto: 'Contable y Financiera' },
  10: { nombre: 'DAYARLYS LIZETH', depto: 'Contable y Financiera' },
  11: { nombre: 'RAFAEL ANDRES', depto: 'Contable y Financiera' },
  12: { nombre: 'PEDRO MIGUEL', depto: 'Contable y Financiera' },
  14: { nombre: 'PAULO CESAR', depto: 'Gestión De Ventas' },
  23: { nombre: 'NAHUM RAFAEL', depto: 'Instalación De Proyecto' },
  27: { nombre: 'FAIBER DAVID', depto: 'Instalación De Proyecto' },
  29: { nombre: 'YOR ANDRES', depto: 'Instalación De Proyecto' },
  33: { nombre: 'DIEGO ARMANDO', depto: 'Gestión De Ventas' },
  35: { nombre: 'ELVER DE JESUS', depto: 'Instalación De Proyecto' },
  36: { nombre: 'DANIELA', depto: 'Gestión De Ventas' },
  38: { nombre: 'ARMANDO SEGUNDO', depto: 'Instalación De Proyecto' },
  39: { nombre: 'ANGELA MARIA', depto: 'Gestión De Ventas' },
  43: { nombre: 'FREDY RICARDO', depto: 'Ingeniería y Diseño' },
  45: { nombre: 'MARIA CAMILA', depto: 'Ingeniería y Diseño' },
  46: { nombre: 'SANTIAGO DAVID', depto: 'Instalación De Proyecto' },
  49: { nombre: 'DANIEL DAVID', depto: 'Instalación De Proyecto' },
  50: { nombre: 'JOSE ALEJANDRO', depto: 'Talento Humano' },
  54: { nombre: 'ROSA MARIA', depto: 'Gestión De Ventas' },
  55: { nombre: 'MARIA ANGELA', depto: 'Infraestructura Y Metrologia' },
  56: { nombre: 'VALENTINA', depto: 'Gestión De Ventas' },
  58: { nombre: 'ELIECER', depto: 'Infraestructura Y Metrologia' },
  60: { nombre: 'ARNOVIS', depto: 'Instalación De Proyecto' },
  66: { nombre: 'ELPIDIO JESUS', depto: 'Instalación De Proyecto' },
  67: { nombre: 'KENDRYS DAYANA', depto: 'Gestión De Ventas' },
  69: { nombre: 'JUAN ANTONIO', depto: 'Instalación De Proyecto' },
  74: { nombre: 'LUIS CARLOS', depto: 'Infraestructura Y Metrologia' },
  77: { nombre: 'OSCAR LUIS', depto: 'Gestión De Ventas' },
  79: { nombre: 'CARLOS ANDRES', depto: 'Instalación De Proyecto' },
  80: { nombre: 'DANILO ENRIQUE', depto: 'Instalación De Proyecto' },
  81: { nombre: 'JHON ALEXANDER', depto: 'Departamento' },
  83: { nombre: 'DAVID ALEXANDER', depto: 'Instalación De Proyecto' },
  85: { nombre: 'JOSE CARLOS', depto: 'Instalación De Proyecto' },
  86: { nombre: 'JUAN DAVID', depto: 'Instalación De Proyecto' },
  87: { nombre: 'CAMILO ANDRES', depto: 'Investigación Y Desarrollo TI' },
  88: { nombre: 'EDINSON RICARDO', depto: 'Contable y Financiera' },
  90: { nombre: 'NAHIREDS TATIANA', depto: 'Ingeniería y Diseño' },
  91: { nombre: 'JESUS FABIAN', depto: 'Talento Humano' },
  92: { nombre: 'ELVIS GUILLERMO', depto: 'Instalación De Proyecto' },
  93: { nombre: 'MATEO', depto: 'Marketing Y Publicidad' },
  94: { nombre: 'CRISTIAN', depto: 'Instalación De Proyecto' },
  95: { nombre: 'ANDRES', depto: 'Instalación De Proyecto' },
  96: { nombre: 'ZERAFÍN', depto: 'Instalación De Proyecto' },
  97: { nombre: 'JEINER JOSE', depto: 'Instalación De Proyecto' },
  98: { nombre: 'KEVIN', depto: 'Instalación De Proyecto' },
  99: { nombre: 'KIMBERLY LUCÍA', depto: 'Gestión De Ventas' },
  100: { nombre: 'RONAL', depto: 'Instalación De Proyecto' },
  101: { nombre: 'LORENA ESTHER', depto: 'Gestión De Ventas' },
  102: { nombre: 'CAMILO ANDRES', depto: 'Instalación De Proyecto' },
  103: { nombre: 'ANDERSON', depto: 'Instalación De Proyecto' },
  104: { nombre: 'ELKIN DAVID', depto: 'Instalación De Proyecto' },
  105: { nombre: 'DANIELA ISABEL', depto: 'Atención al Usuario y Postventa' },
};

/** Devuelve {nombre, depto} o null si el PIN no está en el padrón. */
export function empleado(pin) {
  if (pin == null) return null;
  const n = String(pin).trim();
  if (!n) return null;
  return EMPLEADOS[n] || null;
}

export const TOTAL_EMPLEADOS = Object.values(EMPLEADOS).filter(Boolean).length;
