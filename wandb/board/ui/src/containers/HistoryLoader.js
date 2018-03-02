import React from 'react';
import {graphql, withApollo} from 'react-apollo';
import {fragments, FAKE_HISTORY_QUERY, HISTORY_QUERY} from '../graphql/runs';
import {bindActionCreators} from 'redux';
import {connect} from 'react-redux';
import {filterRuns, sortRuns} from '../util/runhelpers.js';
import {JSONparseNaN} from '../util/jsonnan';
import {MAX_HISTORIES_LOADED} from '../util/constants.js';
import _ from 'lodash';

export default function withHistoryLoader(WrappedComponent) {
  let HistoryLoader = class extends React.Component {
    constructor(props) {
      super(props);
      this.selectedRuns = {};
    }

    _setup(props, nextProps) {
      if (nextProps.data.selectedRuns !== props.data.selectedRuns) {
        //console.log('SelectionQueryThing willReceiveProps', nextProps);
        let selected = _.fromPairs(
          nextProps.data.selectedRuns
            .slice(0, MAX_HISTORIES_LOADED)
            .map(run => [run.name, run.id]),
        );
        // find set of selected runs that have not been fetched
        //console.log('n selected', _.size(selected));
        let selectedInfo = _.map(selected, (id, name) => {
          // if (this.historyLoadedRuns[id]) {
          //   return {id: id, alreadyLoaded: true};
          // }
          let history = null;
          try {
            let result = nextProps.client.readFragment({
              id,
              fragment: fragments.historyRun,
            });
            //console.log('readFragment history result', result);
            history = result.history;
          } catch (err) {
            //console.log("name doesn't have history", name);
          }
          let loadingHistory = false;
          try {
            let result = nextProps.client.readFragment({
              id,
              fragment: fragments.historyRunLoading,
            });
            //console.log('readFragment historyRunLoading result', result);
            loadingHistory = result.historyLoading;
          } catch (err) {
            //console.log("name doesn't have historyLoading", name);
          }
          return {
            id: id,
            name: name,
            history: history,
            loadingHistory: loadingHistory,
          };
        });
        //console.log('selectedInfo', selectedInfo);
        let numLoaded = selectedInfo.filter(o => o.history || o.loadingHistory)
          .length;
        if (numLoaded >= MAX_HISTORIES_LOADED) {
          // console.log(
          //   `Already have ${MAX_HISTORIES_LOADED} run histories loaded/loading. Not loading more.`,
          // );
        } else {
          let toLoad = selectedInfo.filter(
            o => !(o.history || o.loadingHistory),
          );
          //console.log('toLoad', toLoad);
          if (toLoad.length > 0) {
            for (var load of toLoad) {
              nextProps.client.writeFragment({
                id: load.id,
                fragment: fragments.historyRunLoading,
                data: {historyLoading: true, __typename: 'BucketType'},
              });
            }
            nextProps.client
              .query({
                query: HISTORY_QUERY,
                variables: {
                  entityName: this.props.query.entity,
                  name: this.props.query.model,
                  bucketIds: toLoad.map(o => o.name),
                },
              })
              .then(result => {
                //console.log('result', result);
                for (var load of toLoad) {
                  nextProps.client.writeFragment({
                    id: load.id,
                    fragment: fragments.historyRunLoading,
                    data: {historyLoading: false, __typename: 'BucketType'},
                  });
                }
              });
          }
        }
        nextProps.client.writeQuery({
          query: FAKE_HISTORY_QUERY,
          variables: {histQueryKey: nextProps.histQueryKey},
          data: {
            model: {
              id: 'fake_history_query_' + nextProps.histQueryKey,
              __typename: 'ModelType',
              buckets: {
                __typename: 'BucketConnectionType',
                edges: selectedInfo.map(o => ({
                  node: {
                    id: o.id,
                    name: o.name,
                    history: o.history,
                    __typename: 'BucketType',
                  },
                  __typename: 'BucketTypeEdge',
                })),
              },
            },
          },
        });
      }
    }

    componentWillMount() {
      this.historyLoadedRuns = {};
      this._setup({data: {}}, this.props);
    }

    componentWillReceiveProps(nextProps) {
      this._setup(this.props, nextProps);
    }

    render() {
      return (
        <WrappedComponent {...this.props} selectedRuns={this.selectedRuns} />
      );
    }
  };

  function withData() {
    // This is a function so we can keep track of some state variables, and only change child props
    // when necessary for performance.
    let prevBuckets = null;
    let runHistory = [];
    return graphql(FAKE_HISTORY_QUERY, {
      skip: ({query}) => !query.strategy || query.strategy === 'page',
      options: () => {
        return {
          fetchPolicy: 'cache-only',
        };
      },
      props: ({data, errors}) => {
        if (
          data.model &&
          data.model.buckets &&
          prevBuckets !== data.model.buckets
        ) {
          runHistory = data.model.buckets.edges.map(edge => ({
            name: edge.node.name,
            history: edge.node.history
              ? edge.node.history
                  .map((row, i) => {
                    try {
                      return JSONparseNaN(row);
                    } catch (error) {
                      console.log(
                        `WARNING: JSON error parsing history (HistoryLoader):${i}:`,
                        error,
                      );
                      return null;
                    }
                  })
                  .filter(row => row !== null)
              : null,
          }));
          prevBuckets = data.model.buckets;
        }
        //console.log('runHistory', runHistory);
        return {runHistory};
      },
    });
  }

  return withApollo(withData()(HistoryLoader));
}