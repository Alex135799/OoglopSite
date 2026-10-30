import { render } from "@testing-library/react";

import App from "./App";

it("Renders App component", () => {
  const { container } = render(<App />);
  expect(container.childElementCount).toEqual(1);
});
