/** Browser stand-ins for the node built-ins adapter-kit's fixture helpers import. Never called. */
const unavailable = (): never => {
  throw new Error('Not available in the browser');
};

export const mkdir = unavailable;
export const readFile = unavailable;
export const writeFile = unavailable;
export const dirname = unavailable;
export const join = unavailable;
export default {};
