import configureStore from './configureStore';

describe('configureStore', () => {
  it('creates a store with the empty root state', () => {
    const store = configureStore();

    expect(store.getState()).toEqual({});
  });
});
