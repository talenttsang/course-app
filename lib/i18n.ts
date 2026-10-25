// Language for anything we say to a student.
//
// The language follows the COURSE, not a setting someone has to remember to
// flip. Somebody who buys "Certificado en Prótesis Capilares" is buying a
// course taught in Spanish, so every word we send them is Spanish without a
// human deciding it each time — which is the only version of this that keeps
// working once nobody is watching.

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function asLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

// Which courses are taught in which language, keyed by BigCommerce product
// id — the same key order onboarding and the onboarding endpoint already match
// on, so there is no second identifier to keep in step.
//
// This belongs in a courses.locale column, and should move there the next
// time the schema is touched. It is here because adding a column needs
// database credentials this deploy path doesn't have, and a student who has
// paid shouldn't wait on that. Anything unlisted is English.
const COURSE_LOCALES: Record<number, Locale> = {
  3827: "es", // Certificado en Prótesis Capilares (superhairpieces.es)
};

export function localeForProduct(productId: number | null | undefined): Locale {
  if (productId == null) return DEFAULT_LOCALE;
  return COURSE_LOCALES[productId] ?? DEFAULT_LOCALE;
}

// When someone holds courses in more than one language we have no way to
// know which they read, so we fall back to English rather than guessing.
export function localeForCourses(productIds: (number | null | undefined)[]): Locale {
  const distinct = new Set(productIds.map(localeForProduct));
  return distinct.size === 1 ? localeForProduct(productIds[0]) : DEFAULT_LOCALE;
}

// Four reasons we send someone their way in, because the wrong one reads as
// a mistake: a fresh purchase is thanked for it; a student carried over from
// the old platform is told what happened to the course they already own;
// someone simply given a course — a comped place — is told that, since
// thanking them for a purchase they never made is plainly wrong; and a
// colleague given the keys to the admin area is told what they can now do,
// which is a different thing from being enrolled in anything.
export type WelcomeKind = "purchase" | "migration" | "granted" | "staff";

type EmailCopy = {
  welcomeSubject: string;
  welcomeHeading: string;
  welcomeIntro: string;
  migrationSubject: string;
  migrationHeading: string;
  migrationIntro: string;
  migrationCourseLabel: string;
  migrationButton: string;
  grantedSubject: string;
  grantedHeading: string;
  grantedIntro: string;
  textGrantedHeading: string;
  textGrantedIntro: string;
  staffSubject: string;
  staffHeading: string;
  staffIntro: string;
  staffButton: string;
  textStaffHeading: string;
  textStaffIntro: string;
  textMigrationHeading: string;
  textMigrationIntro: string;
  nowInYourAccount: string;
  startFirstLesson: string;
  buttonWorksFor: (hours: number) => string;
  signingInLaterTitle: string;
  signingInLaterBody: (loginHost: string, loginUrl: string, brand: string) => string;
  resetSubject: string;
  resetHeading: string;
  resetIntro: (hours: number) => string;
  resetButton: string;
  resetIgnore: string;
  footerQuestions: string;
  // Plain-text alternates, which can't carry entities or markup.
  textWelcomeHeading: string;
  textWelcomeIntro: string;
  textNowInYourAccount: string;
  textStartLesson: (hours: number) => string;
  textSigningInLater: (loginUrl: string) => string;
  textQuestions: string;
  textReset: (url: string, hours: number) => string[];
};

const en: EmailCopy = {
  welcomeSubject: "Your Evolve Academy course is ready",
  welcomeHeading: "You&rsquo;re enrolled &mdash; welcome aboard",
  welcomeIntro:
    "Thank you for your purchase. Your course is unlocked and waiting for you. " +
    "Tap below to get straight in &mdash; you can set a password once you&rsquo;re there.",
  migrationSubject: "Evolve Academy has moved &mdash; here is your new login",
  migrationHeading: "Your course has a new home",
  migrationIntro:
    "We have moved Evolve Academy to a new platform, and your course has come " +
    "with you &mdash; nothing to buy again, and nothing to set up. Tap below to " +
    "go straight in; you can choose a password once you are there.",
  migrationCourseLabel: "YOUR COURSES",
  migrationButton: "Open my course",
  grantedSubject: "You have been given access to Evolve Academy",
  grantedHeading: "Your course is ready",
  grantedIntro:
    "You have been given access to Evolve Academy. Tap below to go straight " +
    "in; you can choose a password once you are there.",
  textGrantedHeading: "Your course is ready",
  textGrantedIntro: "You have been given access to Evolve Academy.",
  staffSubject: "You now have staff access to Evolve Academy",
  staffHeading: "You can now manage Evolve Academy",
  staffIntro:
    "A colleague has given you staff access to Evolve Academy, which lets you " +
    "add and edit courses and lessons, and look after students. Tap below to " +
    "go straight in &mdash; you can choose a password once you are there.",
  staffButton: "Open the admin area",
  textStaffHeading: "You can now manage Evolve Academy",
  textStaffIntro:
    "A colleague has given you staff access to Evolve Academy.\n"
    + "You can add and edit courses and lessons, and look after students.",
  textMigrationHeading: "Your course has a new home",
  textMigrationIntro:
    "We have moved Evolve Academy to a new platform, and your course has come with you.\n"
    + "There is nothing to buy again and nothing to set up.",
  nowInYourAccount: "NOW IN YOUR ACCOUNT",
  startFirstLesson: "Start my first lesson",
  buttonWorksFor: (h) => `That button signs you straight in and works for ${h} hours.`,
  signingInLaterTitle: "Signing in later",
  signingInLaterBody: (host, url, brand) =>
    `Go to <a href="${url}" style="color:${brand};">${host}</a> and sign in with your ` +
    "password, or ask for a one-time link &mdash; whichever you prefer.",
  resetSubject: "Set a new Evolve Academy password",
  resetHeading: "Set a new password",
  resetIntro: (h) =>
    "Tap below to choose a new password for your Evolve Academy account. " +
    `This link can only be used once and expires in ${h} hours.`,
  resetButton: "Choose a new password",
  resetIgnore:
    "If you didn&rsquo;t ask for this, you can safely ignore this email &mdash; " +
    "your password won&rsquo;t change.",
  footerQuestions: "Questions about your course? Reach us at",
  textWelcomeHeading: "You're enrolled - welcome aboard",
  textWelcomeIntro: "Thank you for your purchase. Your course is unlocked and waiting.",
  textNowInYourAccount: "Now in your account:",
  textStartLesson: (h) => `Start your first lesson (signs you in, valid ${h} hours):`,
  textSigningInLater: (url) =>
    `Signing in later: go to ${url} and use your password,\nor ask for a one-time link - whichever you prefer.`,
  textQuestions: "Questions? support@superhairpieces.com",
  textReset: (url, h) => [
    "Set a new password",
    "",
    "Open this link to choose a new password for your Evolve Academy account.",
    `It can only be used once and expires in ${h} hours.`,
    "",
    url,
    "",
    "If you didn't ask for this, ignore this email - your password won't change.",
  ],
};

// Latin-American-neutral Spanish, addressing the student as "tú" — these are
// students of a hands-on trade course, not corporate buyers, and "usted"
// would read as stiff in both Spain and Latin America.
const es: EmailCopy = {
  welcomeSubject: "Tu curso de Evolve Academy ya está listo",
  welcomeHeading: "Ya est&aacute;s inscrito &mdash; te damos la bienvenida",
  welcomeIntro:
    "Gracias por tu compra. Tu curso ya est&aacute; desbloqueado y te espera. " +
    "Pulsa el bot&oacute;n para entrar directamente &mdash; podr&aacute;s crear tu " +
    "contrase&ntilde;a una vez dentro.",
  migrationSubject: "Evolve Academy se ha mudado: aquí tienes tu nuevo acceso",
  migrationHeading: "Tu curso tiene un nuevo hogar",
  migrationIntro:
    "Hemos trasladado Evolve Academy a una nueva plataforma y tu curso se ha " +
    "mudado contigo &mdash; no tienes que volver a comprar nada ni configurar nada. " +
    "Pulsa el bot&oacute;n para entrar directamente; podr&aacute;s elegir tu " +
    "contrase&ntilde;a una vez dentro.",
  migrationCourseLabel: "TUS CURSOS",
  migrationButton: "Abrir mi curso",
  grantedSubject: "Te hemos dado acceso a Evolve Academy",
  grantedIntro:
    "Te hemos dado acceso a Evolve Academy. Pulsa el bot&oacute;n para entrar " +
    "directamente; podr&aacute;s elegir tu contrase&ntilde;a una vez dentro.",
  grantedHeading: "Tu curso est&aacute; listo",
  textGrantedHeading: "Tu curso esta listo",
  textGrantedIntro: "Te hemos dado acceso a Evolve Academy.",
  staffSubject: "Ya tienes acceso de personal a Evolve Academy",
  staffHeading: "Ya puedes gestionar Evolve Academy",
  staffIntro:
    "Un compa&ntilde;ero te ha dado acceso de personal a Evolve Academy, lo que " +
    "te permite crear y editar cursos y lecciones, y atender a los estudiantes. " +
    "Pulsa abajo para entrar &mdash; podr&aacute;s elegir una contrase&ntilde;a " +
    "cuando est&eacute;s dentro.",
  staffButton: "Abrir el panel de administraci&oacute;n",
  textStaffHeading: "Ya puedes gestionar Evolve Academy",
  textStaffIntro:
    "Un companero te ha dado acceso de personal a Evolve Academy.\n"
    + "Puedes crear y editar cursos y lecciones, y atender a los estudiantes.",
  textMigrationHeading: "Tu curso tiene un nuevo hogar",
  textMigrationIntro:
    "Hemos trasladado Evolve Academy a una nueva plataforma y tu curso se ha mudado contigo.\n"
    + "No tienes que volver a comprar nada ni configurar nada.",
  nowInYourAccount: "YA EN TU CUENTA",
  startFirstLesson: "Empezar mi primera lecci&oacute;n",
  buttonWorksFor: (h) =>
    `Ese bot&oacute;n te da acceso directo y es v&aacute;lido durante ${h} horas.`,
  signingInLaterTitle: "Para entrar m&aacute;s adelante",
  signingInLaterBody: (host, url, brand) =>
    `Entra en <a href="${url}" style="color:${brand};">${host}</a> con tu contrase&ntilde;a, ` +
    "o pide un enlace de acceso de un solo uso &mdash; lo que prefieras.",
  resetSubject: "Crea una nueva contraseña de Evolve Academy",
  resetHeading: "Crea una nueva contrase&ntilde;a",
  resetIntro: (h) =>
    "Pulsa el bot&oacute;n para elegir una nueva contrase&ntilde;a para tu cuenta de " +
    `Evolve Academy. El enlace solo se puede usar una vez y caduca en ${h} horas.`,
  resetButton: "Elegir nueva contrase&ntilde;a",
  resetIgnore:
    "Si no has pedido este cambio, puedes ignorar este correo &mdash; " +
    "tu contrase&ntilde;a no cambiar&aacute;.",
  footerQuestions: "&iquest;Tienes dudas sobre tu curso? Escr&iacute;benos a",
  textWelcomeHeading: "Ya estas inscrito - te damos la bienvenida",
  textWelcomeIntro: "Gracias por tu compra. Tu curso ya esta desbloqueado y te espera.",
  textNowInYourAccount: "Ya en tu cuenta:",
  textStartLesson: (h) =>
    `Empieza tu primera leccion (te da acceso directo, valido ${h} horas):`,
  textSigningInLater: (url) =>
    `Para entrar mas adelante: ve a ${url} y usa tu contrasena,\no pide un enlace de un solo uso - lo que prefieras.`,
  textQuestions: "Dudas? support@superhairpieces.com",
  textReset: (url, h) => [
    "Crea una nueva contrasena",
    "",
    "Abre este enlace para elegir una nueva contrasena de tu cuenta de Evolve Academy.",
    `Solo se puede usar una vez y caduca en ${h} horas.`,
    "",
    url,
    "",
    "Si no has pedido este cambio, ignora este correo - tu contrasena no cambiara.",
  ],
};

const COPY: Record<Locale, EmailCopy> = { en, es };

export function emailCopy(locale: Locale): EmailCopy {
  return COPY[locale] ?? COPY[DEFAULT_LOCALE];
}
