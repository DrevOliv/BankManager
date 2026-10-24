// Common first names in Sweden. Used to recognise Swish payments in Handelsbanken
// statements, where a Swish shows up as just the other person's (truncated) name.
const NAMES = `
adam adrian agnes albert albin alex alexander alexandra alfred alice alicia alma alva alvin amanda amelia amir
andrea andreas anders andré angelica angelina anita anja anna annika anton antonia arvid astrid august axel
beatrice bella bengt benjamin birgitta björn bo bror britt camilla carl carola caroline casper cecilia charlie
charlotte christian christina christoffer clara colin cornelia dan daniel david denise dennis diana ebba edith
edvin edward elias elin elina elis elisabet elisabeth ella ellen ellie elliot elsa elvira emil emilia emily emma
eric erik erika esther eva evelina felicia felix filip fredrik frida gabriel gabriella greta gun gunilla gunnar
gustav gustaf hampus hanna hannah hans harald harry hedda hedvig helen helena henrik herman hilda hugo ida ines
inga inger ingrid isa isabella isabelle isak ivar jack jacob jakob jan jasmine jenny jens jesper jessica joakim
joel johan johanna john johnny jonas jonathan josef josefin josefine josephine julia julian julius kajsa karin
karl katarina kevin kim kristian kristina lars leah lena leo leon liam lina linda linn linnea linus lisa liv
loke lou louise lova lovis lovisa lucas ludvig lukas magnus maja malin malte marcus maria marie markus martin
mathias matilda mats matteo mattias max maximilian maya meja melker melvin mia michael mikael milo milla miranda
moa mohammed molly monica moa nathalie nellie nicklas niclas nicole nicolas niklas nils nina noah noel nora
nova olivia oliver olle omar oscar oskar otto patrik paula per peter petra philip pontus rasmus rebecca rebecka
richard robert robin roger rolf ronja rut sabina sagal saga sam samuel sandra sara sarah sebastian selma signe
simon siri sixten sofia sofie stefan stella stina sten susanne svante sven tea tekla thea theo theodor therese
thomas tilda tilde tim tindra tobias tom tomas tora tove ulf ulla ulrika valter vera victor victoria viggo
viktor viktoria vilgot vilhelm vincent wilhelm william wilma yasmin ylva yousef zara
`;

export const FIRST_NAMES = new Set(NAMES.split(/\s+/).filter(Boolean));
