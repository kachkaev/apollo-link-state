import gql from 'graphql-tag';
import { ApolloLink, execute, Observable } from 'apollo-link';
import { ApolloClient } from 'apollo-client';
import { InMemoryCache } from 'apollo-cache-inmemory';

import { withClientState } from '../';

describe('server and client state', () => {
  const query = gql`
    query list {
      list(name: "my list") {
        items {
          id
          name
          isDone
          isSelected @client
        }
      }
    }
  `;
  it('works to merge remote and local state', done => {
    const data = {
      list: {
        __typename: 'List',
        items: [
          { __typename: 'ListItem', id: 1, name: 'first', isDone: true },
          { __typename: 'ListItem', id: 2, name: 'second', isDone: false },
        ],
      },
    };
    // mocked endpoint acting as server data
    const http = new ApolloLink(() => Observable.of({ data }));

    const local = withClientState({
      Mutation: {
        toggleItem: (_, { id }, { cache }) => {
          id = `ListItem:${id}`;
          const fragment = gql`
            fragment item on ListItem {
              __typename
              isSelected
            }
          `;
          const previous = cache.readFragment({ fragment, id });
          const data = {
            ...previous,
            isSelected: !previous.isSelected,
          };
          cache.writeFragment({
            id,
            fragment,
            data,
          });

          return data;
        },
      },
      ListItem: {
        isSelected: (source, args, context) => {
          expect(source.name).toBeDefined();
          // list items default to an unselected state
          return false;
        },
      },
    });

    const client = new ApolloClient({
      link: local.concat(http),
      cache: new InMemoryCache(),
    });

    const observer = client.watchQuery({ query });

    let count = 0;
    const sub = observer.subscribe({
      next: response => {
        if (count === 0) {
          const initial = { ...data };
          initial.list.items = initial.list.items.map(x => ({
            ...x,
            isSelected: false,
          }));
          expect(response.data).toMatchObject(initial);
        }
        if (count === 1) {
          expect(response.data.list.items[0].isSelected).toBe(true);
          expect(response.data.list.items[1].isSelected).toBe(false);
          done();
        }
        count++;
      },
      error: done.fail,
    });
    const variables = { id: 1 };
    const mutation = gql`
      mutation SelectItem($id: Int!) {
        toggleItem(id: $id) @client
      }
    `;
    // after initial result, toggle the state of one of the items
    setTimeout(() => {
      client.mutate({ mutation, variables });
    }, 10);
  });
});
