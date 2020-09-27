import React from "react";
import { render, unmountComponentAtNode } from "react-dom";
import { act } from "react-dom/test-utils";

import App from "./App";

let container: Element = document.createElement("div");

beforeEach(() => {
  // setup a DOM element as a render target
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  // cleanup on exiting
  unmountComponentAtNode(container);
  container.remove();
  container = document.createElement("div");
});

it("Renders App component", () => {
  act(() => {
    render(<App />, container);
  });
  expect(container.childElementCount).toEqual(1);
});